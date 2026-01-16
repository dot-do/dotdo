/**
 * SQL Security Module - Raw Query Protection
 *
 * Provides validation and sanitization for raw SQL queries exposed via RPC.
 * This module enforces read-only access and prevents SQL injection attacks.
 *
 * Security Issue: do-ld03
 * @module core/sql-security
 */

// =============================================================================
// ERROR CLASSES
// =============================================================================

/**
 * Error thrown when a SQL query violates security policies
 */
export class SqlSecurityError extends Error {
  constructor(
    message: string,
    public readonly code: SqlSecurityErrorCode,
    public readonly query?: string
  ) {
    // Use a generic message that doesn't leak SQL structure
    super(message)
    this.name = 'SqlSecurityError'
  }
}

export type SqlSecurityErrorCode =
  | 'WRITE_OPERATION_FORBIDDEN'
  | 'MULTI_STATEMENT_FORBIDDEN'
  | 'COMMENT_FORBIDDEN'
  | 'PRAGMA_FORBIDDEN'
  | 'EMPTY_QUERY'
  | 'INVALID_QUERY'
  | 'COMMAND_FORBIDDEN'

// =============================================================================
// SQL PATTERNS
// =============================================================================

/**
 * SQL statements that are NOT allowed (write/DDL operations)
 * These patterns are checked after normalizing whitespace and case
 */
const FORBIDDEN_STATEMENT_PATTERNS = [
  // DML (write operations)
  /^\s*INSERT\b/i,
  /^\s*UPDATE\b/i,
  /^\s*DELETE\b/i,
  /^\s*REPLACE\b/i,
  /^\s*UPSERT\b/i,

  // DDL (schema operations)
  /^\s*CREATE\b/i,
  /^\s*ALTER\b/i,
  /^\s*DROP\b/i,
  /^\s*TRUNCATE\b/i,
  /^\s*RENAME\b/i,

  // Administrative commands
  /^\s*ATTACH\b/i,
  /^\s*DETACH\b/i,
  /^\s*VACUUM\b/i,
  /^\s*REINDEX\b/i,
  /^\s*ANALYZE\b/i,
  /^\s*PRAGMA\b/i,

  // Transaction control (should be handled by the runtime)
  /^\s*BEGIN\b/i,
  /^\s*COMMIT\b/i,
  /^\s*ROLLBACK\b/i,
  /^\s*SAVEPOINT\b/i,
  /^\s*RELEASE\b/i,

  // SQLite CLI commands (shouldn't execute but reject anyway)
  /^\s*\./,

  // Explain can leak schema info
  /^\s*EXPLAIN\b/i,
]

/**
 * Patterns for multi-statement injection attacks
 * Looks for semicolons followed by another statement
 */
const MULTI_STATEMENT_PATTERN = /;\s*(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA|BEGIN|COMMIT|ROLLBACK)/i

/**
 * Patterns for SQL comment injection
 * Comments can be used to bypass WHERE clauses or hide malicious code
 */
const COMMENT_PATTERNS = [
  /--(?:\s|$)/,      // Single-line comment (-- followed by space or end)
  /\/\*[\s\S]*?\*\//, // Block comment /* */
  /#(?:\s|$)/,        // MySQL-style comment (# followed by space or end)
]

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate a SQL query for security
 *
 * @param sql The SQL query to validate
 * @throws SqlSecurityError if the query violates security policies
 */
export function validateSqlQuery(sql: string): void {
  // Check for empty/null query
  if (!sql || typeof sql !== 'string') {
    throw new SqlSecurityError(
      'Query is required',
      'EMPTY_QUERY'
    )
  }

  const trimmedSql = sql.trim()

  // Check for empty query
  if (trimmedSql.length === 0) {
    throw new SqlSecurityError(
      'Query cannot be empty',
      'EMPTY_QUERY'
    )
  }

  // Check for SQL comments (potential injection vector)
  for (const pattern of COMMENT_PATTERNS) {
    if (pattern.test(trimmedSql)) {
      throw new SqlSecurityError(
        'SQL comments are not allowed',
        'COMMENT_FORBIDDEN'
      )
    }
  }

  // Check for multi-statement injection
  if (MULTI_STATEMENT_PATTERN.test(trimmedSql)) {
    throw new SqlSecurityError(
      'Multiple statements are not allowed',
      'MULTI_STATEMENT_FORBIDDEN'
    )
  }

  // Also check for trailing semicolon followed by any content
  const afterSemicolon = trimmedSql.split(';').slice(1).join(';').trim()
  if (afterSemicolon.length > 0 && !/^[\s-]*$/.test(afterSemicolon)) {
    throw new SqlSecurityError(
      'Multiple statements are not allowed',
      'MULTI_STATEMENT_FORBIDDEN'
    )
  }

  // Check for forbidden statement types (must start with SELECT for safety)
  for (const pattern of FORBIDDEN_STATEMENT_PATTERNS) {
    if (pattern.test(trimmedSql)) {
      throw new SqlSecurityError(
        'Only SELECT queries are allowed',
        'WRITE_OPERATION_FORBIDDEN'
      )
    }
  }

  // Verify query starts with SELECT (positive check)
  if (!/^\s*SELECT\b/i.test(trimmedSql)) {
    throw new SqlSecurityError(
      'Only SELECT queries are allowed',
      'WRITE_OPERATION_FORBIDDEN'
    )
  }
}

/**
 * Sanitize error message to prevent SQL structure leakage
 *
 * @param error The original error
 * @returns A sanitized error message
 */
export function sanitizeSqlError(error: unknown): Error {
  // If it's already our security error, return it
  if (error instanceof SqlSecurityError) {
    return error
  }

  // Get the original message
  const originalMessage = error instanceof Error ? error.message : String(error)

  // Check for various SQLite error patterns and return generic messages
  if (originalMessage.includes('SQLITE_ERROR')) {
    return new SqlSecurityError(
      'Query execution failed',
      'INVALID_QUERY'
    )
  }

  if (originalMessage.includes('syntax error')) {
    return new SqlSecurityError(
      'Invalid query syntax',
      'INVALID_QUERY'
    )
  }

  if (originalMessage.includes('no such table')) {
    return new SqlSecurityError(
      'Table not found',
      'INVALID_QUERY'
    )
  }

  if (originalMessage.includes('no such column')) {
    return new SqlSecurityError(
      'Column not found',
      'INVALID_QUERY'
    )
  }

  if (originalMessage.includes('not authorized')) {
    return new SqlSecurityError(
      'Operation not authorized',
      'COMMAND_FORBIDDEN'
    )
  }

  if (originalMessage.includes('SQLITE_LOCKED') || originalMessage.includes('database table is locked')) {
    return new SqlSecurityError(
      'Operation not permitted',
      'COMMAND_FORBIDDEN'
    )
  }

  // For any other error, return a generic message
  return new SqlSecurityError(
    'Query execution failed',
    'INVALID_QUERY'
  )
}

/**
 * Check if a SQL query is a safe read-only query
 *
 * @param sql The SQL query to check
 * @returns true if the query is safe, false otherwise
 */
export function isSafeQuery(sql: string): boolean {
  try {
    validateSqlQuery(sql)
    return true
  } catch {
    return false
  }
}
