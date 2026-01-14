/**
 * Security Validators
 *
 * Provides validation utilities for preventing common security vulnerabilities:
 * - SQL injection (table name validation, JSON path validation)
 * - Path traversal attacks
 * - Header injection (CRLF injection)
 *
 * @module lib/security/validators
 */

// ============================================================================
// TABLE VALIDATOR
// ============================================================================

/**
 * SQL Injection Prevention - Table name validator
 * Validates table names against a whitelist of allowed tables
 */
export class TableValidator {
  private static readonly ALLOWED_TABLES = new Set([
    'things',
    'events',
    'actions',
    'relationships',
    'objects',
    'search',
    'dlq',
  ])

  private static readonly TABLE_NAME_REGEX = /^[a-z][a-z0-9_]*$/

  /**
   * Validate a table name against the whitelist
   * @throws Error if table name is invalid
   */
  static validate(tableName: string): void {
    // Check for null bytes
    if (tableName.includes('\x00')) {
      throw new Error('Invalid table name: contains null bytes')
    }

    // Check against whitelist
    if (!this.ALLOWED_TABLES.has(tableName)) {
      throw new Error(`Invalid table name: "${tableName}" is not in whitelist`)
    }

    // Validate format
    if (!this.TABLE_NAME_REGEX.test(tableName)) {
      throw new Error(`Invalid table name: "${tableName}" contains invalid characters`)
    }
  }

  /**
   * Check if a table name is valid
   * @returns true if valid, false otherwise
   */
  static isValid(tableName: string): boolean {
    try {
      this.validate(tableName)
      return true
    } catch {
      return false
    }
  }

  /**
   * Add a table to the whitelist (for custom tables)
   */
  static addToWhitelist(tableName: string): void {
    if (!this.TABLE_NAME_REGEX.test(tableName)) {
      throw new Error(`Cannot add "${tableName}" to whitelist: invalid format`)
    }
    this.ALLOWED_TABLES.add(tableName)
  }

  /**
   * Get all allowed table names
   */
  static getAllowed(): string[] {
    return Array.from(this.ALLOWED_TABLES)
  }
}

// ============================================================================
// PATH VALIDATOR
// ============================================================================

/**
 * Path Traversal Prevention
 * Validates file paths against common attack patterns
 */
export class PathValidator {
  static readonly BLOCKED_PATTERNS = [
    /\.\.\//,         // ../
    /\.\.\\/,         // ..\
    /\.\.%2[fF]/,     // ..%2f, ..%2F (URL encoded)
    /\.\.%5[cC]/,     // ..%5c, ..%5C (URL encoded backslash)
    /%00/,            // Null byte (URL encoded)
    /\x00/,           // Null byte (literal)
  ]

  /**
   * Validate a path against traversal attacks
   * @throws Error if path contains traversal patterns
   */
  static validate(path: string): void {
    // Decode URL encoding to catch encoded attacks
    let decodedPath = path
    try {
      decodedPath = decodeURIComponent(path)
    } catch {
      // If decoding fails, use original
    }

    for (const pattern of this.BLOCKED_PATTERNS) {
      if (pattern.test(path) || pattern.test(decodedPath)) {
        throw new Error('Path traversal attempt detected')
      }
    }

    // Check for null bytes
    if (path.includes('\x00') || decodedPath.includes('\x00')) {
      throw new Error('Null byte detected in path')
    }

    // Normalize and check if path escapes root
    const normalized = this.normalize(decodedPath)
    if (normalized.startsWith('..') || normalized.includes('/../')) {
      throw new Error('Path escapes allowed directory')
    }
  }

  /**
   * Normalize a path by resolving . and .. segments
   */
  static normalize(path: string): string {
    // Remove multiple slashes
    let normalized = path.replace(/\/+/g, '/')

    // Resolve . and ..
    const parts = normalized.split('/')
    const result: string[] = []

    for (const part of parts) {
      if (part === '..') {
        if (result.length > 0 && result[result.length - 1] !== '..') {
          result.pop()
        } else {
          result.push('..')
        }
      } else if (part !== '.' && part !== '') {
        result.push(part)
      }
    }

    return result.join('/')
  }

  /**
   * Validate a file extension against an allowlist
   * @throws Error if extension is not allowed or contains dangerous patterns
   */
  static validateExtension(filename: string, allowedExtensions: string[]): void {
    // Get the actual extension (handle double extensions)
    const parts = filename.split('.')
    if (parts.length < 2) {
      throw new Error('File must have an extension')
    }

    const extension = parts[parts.length - 1].toLowerCase()

    // Check for null byte injection (file.php%00.txt)
    if (filename.includes('\x00') || filename.includes('%00')) {
      throw new Error('Null byte detected in filename')
    }

    if (!allowedExtensions.includes(extension)) {
      throw new Error(`Extension ".${extension}" is not allowed`)
    }

    // Check for dangerous extensions anywhere in filename
    const dangerousExtensions = ['php', 'exe', 'sh', 'bat', 'cmd', 'ps1']
    for (const ext of dangerousExtensions) {
      if (parts.slice(0, -1).some(p => p.toLowerCase() === ext)) {
        throw new Error(`Dangerous extension ".${ext}" detected in filename`)
      }
    }
  }
}

// ============================================================================
// HEADER VALIDATOR
// ============================================================================

/**
 * Header Injection Prevention
 * Validates and sanitizes header values to prevent CRLF injection
 */
export class HeaderValidator {
  /**
   * Validate a header value for CRLF injection
   * @throws Error if CRLF characters are detected
   */
  static validate(value: string): string {
    // Check for CRLF injection
    if (/[\r\n]/.test(value)) {
      throw new Error('Header value contains CRLF characters')
    }

    // Check for encoded CRLF (%0d, %0a)
    if (/%0[dD]|%0[aA]/.test(value)) {
      throw new Error('Header value contains encoded CRLF characters')
    }

    // URL decode and check again for double-encoding
    try {
      const decoded = decodeURIComponent(value)
      if (/[\r\n]/.test(decoded)) {
        throw new Error('Header value contains encoded CRLF characters')
      }
    } catch {
      // Decoding failed, that's fine
    }

    return value
  }

  /**
   * Validate a redirect URL for security issues
   * @throws Error if URL is potentially malicious
   */
  static validateRedirectUrl(url: string): string {
    // Check for javascript: protocol
    if (/^javascript:/i.test(url.trim())) {
      throw new Error('JavaScript URLs are not allowed')
    }

    // Check for protocol-relative URLs to external domains
    if (/^\/\/[^\/]/.test(url)) {
      throw new Error('Protocol-relative URLs to external domains are not allowed')
    }

    // Check for CRLF injection
    this.validate(url)

    return url
  }

  /**
   * Sanitize a filename for Content-Disposition header
   */
  static sanitizeFilename(filename: string): string {
    // Remove CRLF
    let sanitized = filename.replace(/[\r\n]/g, '')

    // Remove path separators
    sanitized = sanitized.replace(/[\/\\]/g, '')

    // Remove quotes that could break Content-Disposition
    sanitized = sanitized.replace(/['"]/g, '')

    // Remove path traversal patterns
    sanitized = sanitized.replace(/\.\./g, '')

    // Limit length
    if (sanitized.length > 255) {
      sanitized = sanitized.substring(0, 255)
    }

    return sanitized
  }
}

// ============================================================================
// JSON PATH VALIDATOR
// ============================================================================

/**
 * Validate JSON path expressions against SQL injection patterns
 */
export function validateJsonPath(path: string): void {
  // Valid JSON paths: $, $.field, $.field[0], $.field.nested
  const validPathRegex = /^\$(\.[a-zA-Z_][a-zA-Z0-9_]*|\[\d+\])*$/

  // Check for SQL injection patterns
  const sqlInjectionPatterns = [
    /;\s*(DROP|DELETE|INSERT|UPDATE|SELECT)/i,
    /'\s*(OR|AND)\s+/i,
    /UNION\s+SELECT/i,
    /--/,
    /\/\*.*\*\//,
  ]

  for (const pattern of sqlInjectionPatterns) {
    if (pattern.test(path)) {
      throw new Error('Invalid JSON path: contains SQL injection pattern')
    }
  }

  if (!validPathRegex.test(path)) {
    throw new Error('Invalid JSON path format')
  }
}
