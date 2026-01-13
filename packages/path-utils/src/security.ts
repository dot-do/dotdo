/**
 * @dotdo/path-utils/security - Path Security Validation
 *
 * Provides security validation for paths received from untrusted sources.
 * Prevents path traversal attacks and ensures paths are properly normalized.
 *
 * @example
 * ```typescript
 * import { validatePath, containsPathTraversal, PathSecurityError } from '@dotdo/path-utils/security'
 *
 * const result = validatePath('user/../../../etc/passwd')
 * if (!result.valid) {
 *   console.error('Invalid path:', result.error)
 * }
 * ```
 */

/**
 * Error thrown when a path security violation is detected.
 */
export class PathSecurityError extends Error {
  readonly code: string

  constructor(message: string, code: string = 'PATH_SECURITY_VIOLATION') {
    super(message)
    this.name = 'PathSecurityError'
    this.code = code
  }
}

/**
 * Result of path validation.
 */
export interface PathValidationResult {
  /** Whether the path is valid */
  valid: boolean
  /** Error message if invalid */
  error?: string
  /** Error code if invalid */
  code?: string
  /** Normalized path (if valid) */
  normalizedPath?: string
}

/**
 * Options for path validation.
 */
export interface ValidatePathOptions {
  /** Reject absolute paths (require relative) */
  requireRelative?: boolean
  /** Regex pattern for allowed characters */
  allowedPattern?: RegExp
}

/**
 * Check if a path component is a traversal attempt.
 */
function isTraversalComponent(component: string): boolean {
  // Exact match for ..
  if (component === '..') return true
  // URL-encoded variants
  if (component === '%2e%2e' || component === '%2E%2E') return true
  // Double-URL-encoded
  if (component === '%252e%252e' || component === '%252E%252E') return true
  return false
}

/**
 * Check if a path contains path traversal sequences.
 *
 * @param path - Path to check
 * @returns true if path traversal is detected
 */
export function containsPathTraversal(path: string): boolean {
  // Check for null bytes
  if (path.includes('\0') || path.includes('%00')) {
    return true
  }

  // Check for literal ..
  if (path.includes('..')) {
    return true
  }

  // Check URL-encoded variants (case-insensitive)
  const lowerPath = path.toLowerCase()
  if (lowerPath.includes('%2e%2e') || lowerPath.includes('%252e%252e')) {
    return true
  }

  // Check each component after splitting
  const components = path.split(/[/\\]/)
  for (const component of components) {
    if (isTraversalComponent(component)) {
      return true
    }
  }

  return false
}

/**
 * Check if a path is absolute (Unix or Windows style).
 *
 * @param path - Path to check
 * @returns true if the path is absolute
 */
export function isAbsolutePath(path: string): boolean {
  // Unix absolute path
  if (path.startsWith('/')) return true

  // Windows absolute path (drive letter)
  if (/^[a-zA-Z]:[/\\]/.test(path)) return true

  // Windows UNC path
  if (path.startsWith('\\\\')) return true

  // URL-encoded leading slash
  if (path.startsWith('%2f') || path.startsWith('%2F')) return true

  return false
}

/**
 * Check if a path contains dangerous characters.
 *
 * @param path - Path to check
 * @returns Object with dangerous status and optional reason
 */
export function containsDangerousCharacters(path: string): { dangerous: boolean; reason?: string } {
  // Null byte
  if (path.includes('\0')) {
    return { dangerous: true, reason: 'null byte detected' }
  }

  // Control characters (0x00-0x1f except tab/newline, and 0x7f)
  for (let i = 0; i < path.length; i++) {
    const code = path.charCodeAt(i)
    if ((code >= 0 && code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f) {
      return { dangerous: true, reason: 'control character detected' }
    }
  }

  return { dangerous: false }
}

/**
 * Normalize a path by removing redundant separators and resolving . components.
 * Does NOT resolve .. components - those should be rejected by security validation.
 *
 * @param path - Path to normalize
 * @returns Normalized path
 */
export function normalizePath(path: string): string {
  // Replace backslashes with forward slashes
  let normalized = path.replace(/\\/g, '/')

  // Remove duplicate slashes
  normalized = normalized.replace(/\/+/g, '/')

  // Remove trailing slash (unless it's the root)
  if (normalized.length > 1 && normalized.endsWith('/')) {
    normalized = normalized.slice(0, -1)
  }

  // Remove . components
  const components = normalized.split('/')
  const filtered = components.filter((c) => c !== '.' && c !== '')

  // Preserve leading slash if present
  if (normalized.startsWith('/')) {
    return '/' + filtered.join('/')
  }

  return filtered.join('/') || '.'
}

/**
 * Validate a path for security issues.
 *
 * @param path - Path to validate
 * @param options - Validation options
 * @returns Validation result
 */
export function validatePath(path: string, options: ValidatePathOptions = {}): PathValidationResult {
  // Empty check
  if (!path || path.trim() === '') {
    return { valid: false, error: 'empty path', code: 'EMPTY_PATH' }
  }

  // Trim whitespace
  const trimmed = path.trim()

  // Check for dangerous characters
  const dangerCheck = containsDangerousCharacters(trimmed)
  if (dangerCheck.dangerous) {
    return { valid: false, error: dangerCheck.reason, code: 'DANGEROUS_CHARS' }
  }

  // Check for path traversal
  if (containsPathTraversal(trimmed)) {
    return { valid: false, error: 'path traversal detected', code: 'PATH_TRAVERSAL' }
  }

  // Check for absolute path if requireRelative is set
  if (options.requireRelative && isAbsolutePath(trimmed)) {
    return { valid: false, error: 'absolute path not allowed', code: 'ABSOLUTE_PATH' }
  }

  // Check allowed characters pattern
  if (options.allowedPattern && !options.allowedPattern.test(trimmed)) {
    return { valid: false, error: 'invalid characters in path', code: 'INVALID_CHARS' }
  }

  // Normalize the path
  const normalized = normalizePath(trimmed)

  return { valid: true, normalizedPath: normalized }
}

/**
 * Validate and sanitize a path, throwing on error.
 *
 * @param path - Path to validate
 * @param options - Validation options
 * @throws {PathSecurityError} If security violation detected
 * @returns Normalized path
 */
export function validateSecurePath(path: string, options: ValidatePathOptions = {}): string {
  const result = validatePath(path, options)

  if (!result.valid) {
    throw new PathSecurityError(`Invalid path: ${result.error}`, result.code)
  }

  return result.normalizedPath!
}
