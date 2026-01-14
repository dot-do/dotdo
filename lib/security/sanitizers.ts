/**
 * Security Sanitizers
 *
 * Provides sanitization utilities for preventing common security vulnerabilities:
 * - XSS (HTML escaping)
 * - SQL injection (value escaping)
 * - Prototype pollution (dangerous key filtering)
 *
 * @module lib/security/sanitizers
 */

// ============================================================================
// HTML ESCAPER
// ============================================================================

/**
 * XSS Prevention - HTML Escaper
 * Escapes HTML special characters to prevent XSS attacks
 */
export class HtmlEscaper {
  private static readonly escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
    '`': '&#x60;',
    '=': '&#x3D;',
  }

  /**
   * Escape HTML special characters in a string
   */
  static escape(str: string): string {
    return str.replace(/[&<>"'`=\/]/g, (char) => this.escapeMap[char])
  }

  /**
   * Recursively sanitize an object's string values
   */
  static sanitizeForJson(obj: unknown): unknown {
    if (typeof obj === 'string') {
      return this.escape(obj)
    }
    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitizeForJson(item))
    }
    if (obj !== null && typeof obj === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.sanitizeForJson(value)
      }
      return result
    }
    return obj
  }
}

// ============================================================================
// SQL SANITIZER
// ============================================================================

/**
 * SQL Parameter Sanitizer
 * Ensures values are properly escaped for SQL queries
 *
 * NOTE: Prefer using parameterized queries when possible.
 * This sanitizer is for cases where parameterization is not available.
 */
export class SqlSanitizer {
  /**
   * Sanitize a value for safe SQL string interpolation
   *
   * @param value - Value to sanitize
   * @returns Escaped SQL string representation
   * @throws Error for unsupported value types or infinite numbers
   */
  static sanitizeValue(value: unknown): string {
    if (value === null) return 'NULL'
    if (value === undefined) return 'NULL'
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        throw new Error('Invalid number value: must be finite')
      }
      return String(value)
    }
    if (typeof value === 'boolean') return value ? '1' : '0'
    if (typeof value === 'string') {
      // Escape single quotes by doubling them
      return `'${value.replace(/'/g, "''")}'`
    }
    if (typeof value === 'object') {
      return `'${JSON.stringify(value).replace(/'/g, "''")}'`
    }
    throw new Error(`Unsupported value type: ${typeof value}`)
  }

  /**
   * Sanitize an identifier (table name, column name)
   * Uses double quotes for quoting
   */
  static sanitizeIdentifier(identifier: string): string {
    // Remove any existing quotes and double-quote escape
    const cleaned = identifier.replace(/"/g, '""')
    return `"${cleaned}"`
  }

  /**
   * Sanitize a LIKE pattern (escape % and _)
   */
  static sanitizeLikePattern(pattern: string, escapeChar: string = '\\'): string {
    return pattern
      .replace(new RegExp(`\\${escapeChar}`, 'g'), escapeChar + escapeChar)
      .replace(/%/g, escapeChar + '%')
      .replace(/_/g, escapeChar + '_')
  }
}

// ============================================================================
// OBJECT SANITIZER
// ============================================================================

/**
 * Prototype Pollution Prevention
 * Removes dangerous keys that could be used for prototype pollution attacks
 */
export class ObjectSanitizer {
  static readonly DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype']

  /**
   * Sanitize an object by removing dangerous keys
   */
  static sanitize(obj: unknown): unknown {
    if (obj === null || typeof obj !== 'object') {
      return obj
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sanitize(item))
    }

    const result: Record<string, unknown> = {}
    // Use Object.getOwnPropertyNames to get all keys including non-enumerable
    const keys = Object.getOwnPropertyNames(obj)
    for (const key of keys) {
      // Skip dangerous keys
      if (this.DANGEROUS_KEYS.includes(key)) {
        continue
      }

      // Also check for keys that look like prototype pollution
      if (key.includes('__proto__') || key.includes('constructor.prototype')) {
        continue
      }

      result[key] = this.sanitize((obj as Record<string, unknown>)[key])
    }

    return result
  }

  /**
   * Check if an object contains dangerous keys
   */
  static hasDangerousKeys(obj: unknown): boolean {
    if (obj === null || typeof obj !== 'object') {
      return false
    }

    if (Array.isArray(obj)) {
      return obj.some(item => this.hasDangerousKeys(item))
    }

    // Use Object.getOwnPropertyNames to check all keys including non-enumerable
    const keys = Object.getOwnPropertyNames(obj)
    for (const key of keys) {
      if (this.DANGEROUS_KEYS.includes(key) ||
          key.includes('__proto__') ||
          key.includes('constructor.prototype')) {
        return true
      }
      if (this.hasDangerousKeys((obj as Record<string, unknown>)[key])) {
        return true
      }
    }

    return false
  }
}
