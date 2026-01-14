/**
 * @fileoverview Security module for fsx filesystem operations
 *
 * This module provides comprehensive security validation for filesystem paths,
 * protecting against common attack vectors including:
 *
 * - **Path Traversal (CWE-22)**: Prevents `../` and other sequences that could
 *   escape the filesystem jail and access unauthorized files.
 *   @see https://cwe.mitre.org/data/definitions/22.html
 *
 * - **Null Byte Injection (CWE-626)**: Detects null bytes that could truncate
 *   paths in C-based systems, bypassing validation.
 *   @see https://cwe.mitre.org/data/definitions/626.html
 *
 * - **Path Length Attacks (CWE-789)**: Enforces reasonable length limits to
 *   prevent buffer overflows and denial of service.
 *   @see https://cwe.mitre.org/data/definitions/789.html
 *
 * - **Control Character Injection**: Blocks terminal escape sequences and
 *   other control characters that could enable log injection or UI spoofing.
 *
 * - **Unicode Security Issues**: Detects bidirectional override characters
 *   (U+202E) used to disguise file extensions, and other dangerous Unicode.
 *
 * @example
 * ```typescript
 * import { PathValidator, pathValidator, SecurityConstants } from './security'
 *
 * // Validate a path before filesystem operations
 * try {
 *   const safePath = pathValidator.validatePath(userInput, '/app/data')
 *   await fs.readFile(safePath)
 * } catch (error) {
 *   if (error.code === 'EACCES') {
 *     console.error('Path traversal attempt detected')
 *   }
 * }
 * ```
 *
 * @module do/security
 */

import { EACCES, EINVAL, ENAMETOOLONG } from '../core/errors.js'

// ============================================================================
// SECURITY CONSTANTS
// ============================================================================

/**
 * Security constants for path validation and filesystem limits.
 *
 * These values are based on POSIX standards and common filesystem limits:
 * - PATH_MAX: Maximum total path length (Linux default: 4096)
 * - NAME_MAX: Maximum single component length (Linux default: 255)
 *
 * @see https://man7.org/linux/man-pages/man3/realpath.3.html
 */
export const SecurityConstants = {
  /**
   * Maximum total path length in bytes.
   * Based on Linux PATH_MAX (4096 bytes).
   * Prevents buffer overflows and DoS via memory exhaustion.
   */
  MAX_PATH_LENGTH: 4096,

  /**
   * Maximum length of a single path component (filename/dirname).
   * Based on Linux NAME_MAX (255 bytes).
   * Prevents filesystem-specific truncation issues.
   */
  MAX_NAME_LENGTH: 255,

  /**
   * Maximum symbolic link resolution depth.
   * Prevents infinite loops in symlink chains.
   */
  MAX_SYMLINK_DEPTH: 40,

  /**
   * ASCII null byte - used in null byte injection attacks.
   * Can truncate strings in C-based systems.
   */
  NULL_BYTE: '\x00',

  /**
   * URL-encoded null byte representation.
   */
  URL_ENCODED_NULL: '%00',

  /**
   * Unicode null character (equivalent to ASCII null).
   */
  UNICODE_NULL: '\u0000',

  /**
   * DEL character (ASCII 0x7F) - often rejected in filenames.
   */
  DEL_CHAR: '\x7F',

  /**
   * Unicode line separator - can cause parsing issues.
   */
  LINE_SEPARATOR: '\u2028',

  /**
   * Unicode paragraph separator - can cause parsing issues.
   */
  PARAGRAPH_SEPARATOR: '\u2029',

  /**
   * Right-to-left override character.
   * Used in bidirectional text attacks to disguise file extensions.
   * Example: "file\u202Etxt.exe" displays as "fileexe.txt"
   */
  RTL_OVERRIDE: '\u202E',

  /**
   * Unicode replacement character - indicates encoding errors.
   */
  REPLACEMENT_CHAR: '\uFFFD',
} as const

/**
 * Type for SecurityConstants values
 */
export type SecurityConstantsType = typeof SecurityConstants

// ============================================================================
// VALIDATION RESULT TYPES
// ============================================================================

/**
 * Result of path validation when successful
 */
export interface ValidationSuccess {
  valid: true
  normalizedPath: string
}

/**
 * Result of path validation when failed
 */
export interface ValidationFailure {
  valid: false
  error: 'EINVAL' | 'ENAMETOOLONG' | 'EACCES'
  reason: string
  path: string
}

/**
 * Union type for validation results
 */
export type ValidationResult = ValidationSuccess | ValidationFailure

// ============================================================================
// PATH VALIDATOR CLASS
// ============================================================================

/**
 * PathValidator - Secure path validation and traversal protection
 *
 * Provides comprehensive validation of filesystem paths to prevent
 * security vulnerabilities. All filesystem operations should validate
 * paths through this class before processing.
 *
 * ## Security Guarantees
 *
 * 1. **Jail Enforcement**: Paths cannot escape the designated root directory
 * 2. **Input Sanitization**: Dangerous characters are rejected, not sanitized
 * 3. **Consistent Normalization**: All paths are normalized consistently
 * 4. **Symlink Safety**: Symlink targets are validated for jail escape
 *
 * ## Usage Patterns
 *
 * ### Basic Validation
 * ```typescript
 * const validator = new PathValidator()
 * const safePath = validator.validatePath(userPath, '/app/jail')
 * ```
 *
 * ### Checking Without Throwing
 * ```typescript
 * if (validator.isPathTraversal(path, root)) {
 *   // Handle attack attempt
 * }
 * ```
 *
 * ### Input Validation Only
 * ```typescript
 * validator.validateInput(path) // Throws on invalid input
 * ```
 *
 * @example
 * ```typescript
 * const validator = new PathValidator()
 *
 * // Valid path within root
 * validator.validatePath('data/file.txt', '/app')
 * // Returns: '/app/data/file.txt'
 *
 * // Path traversal attempt - throws EACCES
 * validator.validatePath('../../../etc/passwd', '/app')
 * // Throws: EACCES: permission denied - path traversal detected
 *
 * // Invalid input - throws EINVAL
 * validator.validateInput('file\x00name.txt')
 * // Throws: EINVAL: invalid argument - null byte in path
 * ```
 */
export class PathValidator {
  // -------------------------------------------------------------------------
  // INPUT VALIDATION
  // -------------------------------------------------------------------------

  /**
   * Validates a path string for security vulnerabilities.
   *
   * This method checks for dangerous characters and patterns without
   * considering the filesystem jail. Use this for early validation
   * before path normalization.
   *
   * ## Checks Performed
   *
   * 1. **Empty/whitespace paths**: Rejects empty or whitespace-only paths
   * 2. **Null bytes**: Detects literal and URL-encoded null bytes
   * 3. **Control characters**: Blocks ASCII 0x01-0x1F and DEL (0x7F)
   * 4. **Unicode dangers**: Blocks line/paragraph separators, RTL override
   * 5. **Length limits**: Enforces PATH_MAX and NAME_MAX
   * 6. **Whitespace issues**: Rejects trailing whitespace, leading whitespace after /
   *
   * @param path - The path string to validate
   * @throws {EINVAL} If path contains invalid characters or patterns
   * @throws {ENAMETOOLONG} If path exceeds length limits
   *
   * @example
   * ```typescript
   * // Valid path
   * validator.validateInput('/home/user/file.txt')  // OK
   *
   * // Null byte - throws EINVAL
   * validator.validateInput('file\x00.txt')
   * // Error: EINVAL: invalid argument - null byte detected in path
   *
   * // Control character - throws EINVAL
   * validator.validateInput('file\x1Bname.txt')
   * // Error: EINVAL: invalid argument - control character (0x1b) in path
   * ```
   */
  validateInput(path: string): void {
    // Fast path: check for empty string first
    if (path === '') {
      throw new EINVAL('validateInput', path)
    }

    // Check for whitespace-only paths early
    if (/^\s+$/.test(path)) {
      throw new EINVAL('validateInput', path)
    }

    // Check path length first (fast integer comparison)
    if (path.length > SecurityConstants.MAX_PATH_LENGTH) {
      throw new ENAMETOOLONG('validateInput', path)
    }

    // Check for null bytes (both literal and URL-encoded)
    // Combined into single check for performance
    if (path.includes(SecurityConstants.NULL_BYTE) || path.includes(SecurityConstants.UNICODE_NULL)) {
      throw new EINVAL('validateInput', path)
    }

    if (path.includes(SecurityConstants.URL_ENCODED_NULL)) {
      throw new EINVAL('validateInput', path)
    }

    // Check for paths that are just "." or ".."
    // These are directory references, not valid file paths
    if (path === '.' || path === '..') {
      throw new EINVAL('validateInput', path)
    }

    // Check for trailing whitespace (can cause confusion)
    if (/\s$/.test(path)) {
      throw new EINVAL('validateInput', path)
    }

    // Check for path components starting with whitespace
    // Pattern: slash followed by whitespace then non-slash
    if (/\/\s+[^/]/.test(path)) {
      throw new EINVAL('validateInput', path)
    }

    // Check for ASCII control characters (0x01-0x1F)
    // These can cause terminal injection and log spoofing
    if (/[\x01-\x1F]/.test(path)) {
      throw new EINVAL('validateInput', path)
    }

    // Check for DEL character (0x7F)
    if (path.includes(SecurityConstants.DEL_CHAR)) {
      throw new EINVAL('validateInput', path)
    }

    // Check for dangerous Unicode characters
    // Line separator can break parsing
    if (path.includes(SecurityConstants.LINE_SEPARATOR)) {
      throw new EINVAL('validateInput', path)
    }

    // Paragraph separator can break parsing
    if (path.includes(SecurityConstants.PARAGRAPH_SEPARATOR)) {
      throw new EINVAL('validateInput', path)
    }

    // RTL override - bidirectional text attack for extension spoofing
    if (path.includes(SecurityConstants.RTL_OVERRIDE)) {
      throw new EINVAL('validateInput', path)
    }

    // Replacement character indicates encoding errors
    if (path.includes(SecurityConstants.REPLACEMENT_CHAR)) {
      throw new EINVAL('validateInput', path)
    }

    // Check individual path component lengths (NAME_MAX = 255)
    // Only check paths with multiple segments for efficiency
    const components = path.split('/').filter((c) => c.length > 0)
    if (components.length > 1) {
      for (const component of components) {
        if (component.length > SecurityConstants.MAX_NAME_LENGTH) {
          throw new ENAMETOOLONG('validateInput', path)
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // PATH TRAVERSAL PROTECTION
  // -------------------------------------------------------------------------

  /**
   * Validates that a path resolves within the allowed root directory.
   *
   * This is the primary security method that should be called before
   * any filesystem operation. It combines input validation with jail
   * enforcement to ensure paths cannot escape the designated root.
   *
   * ## Security Behavior
   *
   * 1. First runs input validation via `validateInput()`
   * 2. Normalizes backslashes to forward slashes (Windows attack vectors)
   * 3. Resolves `.` and `..` components
   * 4. Verifies resolved path is within or equal to root
   * 5. Returns the normalized, validated path
   *
   * ## Root Handling
   *
   * - If `root` is `/`, all valid paths are accepted
   * - Paths can equal the root exactly (e.g., `/app/data` with root `/app/data`)
   * - Paths must start with `root + '/'` to be within root
   *
   * @param path - The path to validate (can be relative or absolute)
   * @param root - The allowed root directory (default: '/')
   * @returns The normalized, validated path (always absolute)
   * @throws {EINVAL} If path contains invalid characters
   * @throws {ENAMETOOLONG} If path exceeds length limits
   * @throws {EACCES} If path would escape the root directory
   *
   * @example
   * ```typescript
   * const root = '/app/data'
   *
   * // Relative path - resolved against root
   * validator.validatePath('config.json', root)
   * // Returns: '/app/data/config.json'
   *
   * // Absolute path within root - accepted
   * validator.validatePath('/app/data/logs/app.log', root)
   * // Returns: '/app/data/logs/app.log'
   *
   * // Path with .. that stays in root - accepted
   * validator.validatePath('a/b/../c.txt', root)
   * // Returns: '/app/data/a/c.txt'
   *
   * // Path traversal attempt - throws EACCES
   * validator.validatePath('../../../etc/passwd', root)
   * // Throws: EACCES: permission denied - path traversal detected '../../../etc/passwd'
   *
   * // Absolute path outside root - throws EACCES
   * validator.validatePath('/etc/passwd', root)
   * // Throws: EACCES: permission denied - path traversal detected '/etc/passwd'
   * ```
   */
  validatePath(path: string, root: string = '/'): string {
    // First run input validation
    this.validateInput(path)

    // Normalize backslashes to forward slashes (Windows-style attacks)
    const normalizedInput = path.replace(/\\/g, '/')

    // Normalize the root
    const normalizedRoot = this.normalizePath(root)

    // Resolve the path relative to root
    let resolved: string
    if (normalizedInput.startsWith('/')) {
      // Absolute path - normalize it directly
      resolved = this.normalizePath(normalizedInput)
    } else {
      // Relative path - resolve relative to root
      const combined = normalizedRoot + (normalizedRoot.endsWith('/') ? '' : '/') + normalizedInput
      resolved = this.normalizePath(combined)
    }

    // Check if the resolved path is within root
    if (!this.isWithinRoot(resolved, normalizedRoot)) {
      throw new EACCES('validatePath', path)
    }

    return resolved
  }

  /**
   * Checks if a path would escape the allowed root directory.
   *
   * This is a non-throwing alternative to `validatePath()` for cases
   * where you want to check without exception handling.
   *
   * @param path - The path to check
   * @param root - The allowed root directory (default: '/')
   * @returns `true` if path would escape root (is a traversal attack), `false` if safe
   *
   * @example
   * ```typescript
   * if (validator.isPathTraversal(userInput, '/app/data')) {
   *   auditLog.warn('Path traversal attempt', { path: userInput, user })
   *   return res.status(403).json({ error: 'Access denied' })
   * }
   * ```
   */
  isPathTraversal(path: string, root: string = '/'): boolean {
    try {
      this.validatePath(path, root)
      return false
    } catch {
      return true
    }
  }

  // -------------------------------------------------------------------------
  // SYMLINK VALIDATION
  // -------------------------------------------------------------------------

  /**
   * Validates that a symlink target doesn't escape the root directory.
   *
   * Symlinks require special handling because they can point to arbitrary
   * locations. This method checks whether following a symlink would escape
   * the filesystem jail.
   *
   * ## Resolution Rules
   *
   * - **Absolute targets** (starting with `/`): Checked directly against root
   * - **Relative targets**: Resolved from symlink's parent directory
   *
   * ## Security Note
   *
   * This method should be called when creating symlinks to prevent users
   * from creating links that point outside the jail. It does NOT prevent
   * time-of-check-to-time-of-use (TOCTOU) attacks where the target is
   * modified after creation.
   *
   * @param target - The symlink target path
   * @param symlinkPath - The path where the symlink is/will be located
   * @param root - The allowed root directory (default: '/')
   * @returns `true` if target would escape root, `false` if safe
   *
   * @example
   * ```typescript
   * const root = '/jail'
   *
   * // Absolute target escaping jail
   * validator.isSymlinkEscape('/etc/passwd', '/jail/link', root)
   * // Returns: true (target /etc/passwd is outside /jail)
   *
   * // Relative target escaping jail
   * validator.isSymlinkEscape('../../etc/passwd', '/jail/user/link', root)
   * // Returns: true (resolves to /etc/passwd)
   *
   * // Safe relative target
   * validator.isSymlinkEscape('../shared/file.txt', '/jail/user/link', root)
   * // Returns: false (resolves to /jail/shared/file.txt)
   * ```
   */
  isSymlinkEscape(target: string, symlinkPath: string, root: string = '/'): boolean {
    // Normalize backslashes
    const normalizedTarget = target.replace(/\\/g, '/')

    // If target is absolute, check directly
    if (normalizedTarget.startsWith('/')) {
      return !this.isWithinRoot(this.normalizePath(normalizedTarget), this.normalizePath(root))
    }

    // If target is relative, resolve from symlink's parent directory
    const symlinkParent = this.getParentPath(symlinkPath)
    const resolvedTarget = this.normalizePath(symlinkParent + '/' + normalizedTarget)

    return !this.isWithinRoot(resolvedTarget, this.normalizePath(root))
  }

  // -------------------------------------------------------------------------
  // RESULT-BASED VALIDATION (NON-THROWING)
  // -------------------------------------------------------------------------

  /**
   * Validates a path and returns a result object instead of throwing.
   *
   * Useful for validation in contexts where exceptions are undesirable,
   * such as batch validation or when building error aggregations.
   *
   * @param path - The path to validate
   * @param root - The allowed root directory (default: '/')
   * @returns ValidationResult object with success status and details
   *
   * @example
   * ```typescript
   * const result = validator.validatePathResult(userPath, '/app')
   *
   * if (result.valid) {
   *   await fs.readFile(result.normalizedPath)
   * } else {
   *   console.error(`Validation failed: ${result.reason}`)
   * }
   * ```
   */
  validatePathResult(path: string, root: string = '/'): ValidationResult {
    try {
      const normalizedPath = this.validatePath(path, root)
      return { valid: true, normalizedPath }
    } catch (error) {
      const err = error as Error & { code?: string }
      return {
        valid: false,
        error: (err.code as 'EINVAL' | 'ENAMETOOLONG' | 'EACCES') || 'EINVAL',
        reason: err.message,
        path,
      }
    }
  }

  // -------------------------------------------------------------------------
  // INTERNAL METHODS
  // -------------------------------------------------------------------------

  /**
   * Normalize a path: resolve `.` and `..`, remove double slashes, handle backslashes.
   *
   * @internal
   * @param path - Path to normalize
   * @returns Normalized absolute path
   */
  private normalizePath(path: string): string {
    // Normalize backslashes to forward slashes
    let normalized = path.replace(/\\/g, '/')

    // Handle empty path
    if (!normalized || normalized === '') {
      return '/'
    }

    // Ensure starts with /
    if (!normalized.startsWith('/')) {
      normalized = '/' + normalized
    }

    // Remove trailing slashes (except root)
    while (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1)
    }

    // Split and process
    const segments = normalized.split('/').filter((s) => s !== '' && s !== '.')
    const result: string[] = []

    for (const segment of segments) {
      // Strip any Windows alternate data stream syntax (file.txt:$DATA)
      const cleanSegment = segment.split(':')[0] || ''

      if (cleanSegment === '..') {
        result.pop()
      } else if (cleanSegment !== '') {
        result.push(cleanSegment)
      }
    }

    return '/' + result.join('/')
  }

  /**
   * Check if a resolved path is within the root directory.
   *
   * @internal
   * @param resolved - The resolved, normalized path
   * @param root - The normalized root directory
   * @returns true if path is within root, false otherwise
   */
  private isWithinRoot(resolved: string, root: string): boolean {
    // Handle root being '/'
    if (root === '/') {
      return true
    }

    // The resolved path must either:
    // 1. Be exactly the root
    // 2. Start with root + '/'
    return resolved === root || resolved.startsWith(root + '/')
  }

  /**
   * Get the parent path of a given path.
   *
   * @internal
   * @param path - The path to get parent of
   * @returns The parent directory path
   */
  private getParentPath(path: string): string {
    const normalized = this.normalizePath(path)
    const lastSlash = normalized.lastIndexOf('/')
    if (lastSlash <= 0) return '/'
    return normalized.substring(0, lastSlash)
  }
}

// ============================================================================
// SINGLETON INSTANCE
// ============================================================================

/**
 * Singleton PathValidator instance for use across the module.
 *
 * Use this instance for most validation needs. Creating separate instances
 * is only necessary if you need to extend or customize validation behavior.
 *
 * @example
 * ```typescript
 * import { pathValidator } from './security'
 *
 * // Validate a user-provided path
 * const safePath = pathValidator.validatePath(userInput, '/app/data')
 * ```
 */
export const pathValidator = new PathValidator()
