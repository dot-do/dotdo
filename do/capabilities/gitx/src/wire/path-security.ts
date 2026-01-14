/**
 * @fileoverview Path Security Validation for Wire Protocol
 *
 * This module provides security validation for paths and refs received from
 * clients via the wire protocol. It prevents path traversal attacks and ensures
 * paths are properly normalized and scoped.
 *
 * @module wire/path-security
 *
 * ## Security Considerations
 *
 * - Prevents path traversal via `../` sequences
 * - Rejects absolute paths starting with `/` or drive letters
 * - Normalizes paths to remove redundant separators
 * - Validates ref names are within allowed namespace
 * - Blocks null bytes and other control characters
 *
 * @example
 * ```typescript
 * import { validateRefPath, validateRepositoryId, PathSecurityError } from './path-security'
 *
 * try {
 *   validateRefPath('refs/heads/main')  // OK
 *   validateRefPath('refs/../../../etc/passwd')  // Throws PathSecurityError
 * } catch (e) {
 *   if (e instanceof PathSecurityError) {
 *     console.error('Security violation:', e.message)
 *   }
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
 * Check if a path component is a traversal attempt.
 *
 * @param component - Path component to check
 * @returns true if this is a traversal component
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
 * Check if a path is absolute.
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
 * @returns Object with valid status and optional error
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
 * Does NOT resolve .. components - those should be rejected.
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
  const filtered = components.filter(c => c !== '.' && c !== '')

  // Preserve leading slash if present
  if (normalized.startsWith('/')) {
    return '/' + filtered.join('/')
  }

  return filtered.join('/') || '.'
}

/**
 * Validate a ref path for security issues.
 *
 * @description
 * Validates a Git ref path to ensure it:
 * - Does not contain path traversal sequences
 * - Is not an absolute path
 * - Does not contain dangerous characters
 * - Starts with a valid ref prefix (refs/, HEAD)
 *
 * @param refPath - Ref path to validate
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validateRefPath('refs/heads/main')
 * // result.valid === true
 *
 * const badResult = validateRefPath('refs/heads/../../../etc/passwd')
 * // badResult.valid === false
 * // badResult.error === 'path traversal detected'
 * ```
 */
export function validateRefPath(refPath: string): PathValidationResult {
  // Empty check
  if (!refPath || refPath.trim() === '') {
    return { valid: false, error: 'empty ref path', code: 'EMPTY_PATH' }
  }

  // Trim whitespace
  const trimmed = refPath.trim()

  // Check for dangerous characters
  const dangerCheck = containsDangerousCharacters(trimmed)
  if (dangerCheck.dangerous) {
    return { valid: false, error: dangerCheck.reason, code: 'DANGEROUS_CHARS' }
  }

  // Check for path traversal
  if (containsPathTraversal(trimmed)) {
    return { valid: false, error: 'path traversal detected', code: 'PATH_TRAVERSAL' }
  }

  // Check for absolute path
  if (isAbsolutePath(trimmed)) {
    return { valid: false, error: 'absolute path not allowed', code: 'ABSOLUTE_PATH' }
  }

  // Validate ref prefix (must start with refs/ or be HEAD)
  const validPrefixes = ['refs/', 'HEAD']
  const hasValidPrefix = validPrefixes.some(prefix =>
    trimmed === prefix.replace(/\/$/, '') || trimmed.startsWith(prefix)
  )

  if (!hasValidPrefix) {
    return { valid: false, error: 'invalid ref prefix', code: 'INVALID_PREFIX' }
  }

  // Normalize the path
  const normalized = normalizePath(trimmed)

  // After normalization, re-check that we still have valid prefix
  // (normalization shouldn't change valid paths, but double-check)
  const normalizedHasValidPrefix = validPrefixes.some(prefix =>
    normalized === prefix.replace(/\/$/, '') || normalized.startsWith(prefix)
  )

  if (!normalizedHasValidPrefix) {
    return { valid: false, error: 'path escapes ref namespace after normalization', code: 'NAMESPACE_ESCAPE' }
  }

  return { valid: true, normalizedPath: normalized }
}

/**
 * Validate a repository identifier for security issues.
 *
 * @description
 * Validates a repository identifier to ensure it:
 * - Does not contain path traversal sequences
 * - Is not an absolute path
 * - Does not contain dangerous characters
 * - Contains only allowed characters (alphanumeric, dash, underscore, dot, slash)
 *
 * @param repoId - Repository identifier to validate
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const result = validateRepositoryId('my-org/my-repo')
 * // result.valid === true
 *
 * const badResult = validateRepositoryId('../../../etc/passwd')
 * // badResult.valid === false
 * ```
 */
export function validateRepositoryId(repoId: string): PathValidationResult {
  // Empty check
  if (!repoId || repoId.trim() === '') {
    return { valid: false, error: 'empty repository identifier', code: 'EMPTY_PATH' }
  }

  // Trim whitespace
  const trimmed = repoId.trim()

  // Check for dangerous characters
  const dangerCheck = containsDangerousCharacters(trimmed)
  if (dangerCheck.dangerous) {
    return { valid: false, error: dangerCheck.reason, code: 'DANGEROUS_CHARS' }
  }

  // Check for path traversal
  if (containsPathTraversal(trimmed)) {
    return { valid: false, error: 'path traversal detected', code: 'PATH_TRAVERSAL' }
  }

  // Check for absolute path
  if (isAbsolutePath(trimmed)) {
    return { valid: false, error: 'absolute path not allowed', code: 'ABSOLUTE_PATH' }
  }

  // Validate allowed characters (alphanumeric, dash, underscore, dot, slash)
  // Also allow .git suffix which is common
  const allowedPattern = /^[a-zA-Z0-9_\-./]+$/
  if (!allowedPattern.test(trimmed)) {
    return { valid: false, error: 'invalid characters in repository identifier', code: 'INVALID_CHARS' }
  }

  // Normalize the path
  const normalized = normalizePath(trimmed)

  // Strip .git suffix for consistency
  const withoutGit = normalized.replace(/\.git\/?$/, '')

  return { valid: true, normalizedPath: withoutGit || normalized }
}

/**
 * Validate and sanitize a ref name for security.
 *
 * @description
 * Combines Git ref name validation with security checks.
 * This should be used in addition to the standard validateRefName function.
 *
 * @param refName - Ref name to validate
 * @throws {PathSecurityError} If security violation detected
 * @returns Normalized ref name
 *
 * @example
 * ```typescript
 * const safe = validateSecureRefName('refs/heads/main')  // 'refs/heads/main'
 * validateSecureRefName('refs/../etc/passwd')  // throws PathSecurityError
 * ```
 */
export function validateSecureRefName(refName: string): string {
  const result = validateRefPath(refName)

  if (!result.valid) {
    throw new PathSecurityError(
      `Invalid ref name: ${result.error}`,
      result.code
    )
  }

  return result.normalizedPath!
}

/**
 * Validate and sanitize a repository identifier for security.
 *
 * @param repoId - Repository identifier to validate
 * @throws {PathSecurityError} If security violation detected
 * @returns Normalized repository identifier
 */
export function validateSecureRepositoryId(repoId: string): string {
  const result = validateRepositoryId(repoId)

  if (!result.valid) {
    throw new PathSecurityError(
      `Invalid repository identifier: ${result.error}`,
      result.code
    )
  }

  return result.normalizedPath!
}
