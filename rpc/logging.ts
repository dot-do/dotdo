/**
 * RPC Error Logging Utilities
 *
 * Provides utilities for enhanced RPC error logging with:
 * - Sensitive data sanitization (passwords, tokens, secrets)
 * - Structured error context (method, args, stack, correlation ID, timestamp)
 * - Safe argument serialization with depth limits
 *
 * @module rpc/logging
 */

import { createLogger } from '../utils/logger'

const logger = createLogger('[RPC]')

/**
 * List of keys that should be redacted from log output
 * Case-insensitive matching is used
 */
const SENSITIVE_KEYS = new Set([
  // Authentication
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'apitoken',
  'api_token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'bearer',
  'authorization',
  'auth',
  'credential',
  'credentials',
  // Cryptographic
  'privatekey',
  'private_key',
  'secretkey',
  'secret_key',
  'signingkey',
  'signing_key',
  'encryptionkey',
  'encryption_key',
  'hmac',
  'signature',
  // Session/Cookie
  'session',
  'sessionid',
  'session_id',
  'cookie',
  'cookies',
  // Personal identifiable information
  'ssn',
  'socialsecurity',
  'social_security',
  'creditcard',
  'credit_card',
  'cardnumber',
  'card_number',
  'cvv',
  'cvc',
  'pin',
  // Database
  'connectionstring',
  'connection_string',
  'dbpassword',
  'db_password',
])

/**
 * Placeholder for redacted values
 */
const REDACTED = '[REDACTED]'

/**
 * Maximum depth for recursive sanitization
 */
const MAX_SANITIZE_DEPTH = 10

/**
 * Maximum string length before truncation
 */
const MAX_STRING_LENGTH = 500

/**
 * Maximum array length before truncation
 */
const MAX_ARRAY_LENGTH = 20

/**
 * Check if a key name indicates sensitive data
 * Uses case-insensitive matching
 */
function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase().replace(/[-_]/g, '')
  return SENSITIVE_KEYS.has(lowerKey)
}

/**
 * Check if a string value looks like a sensitive value
 * (e.g., JWT tokens, API keys, base64 encoded secrets)
 */
function isSensitiveValue(value: string): boolean {
  // JWT token pattern (three base64 segments separated by dots)
  if (/^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) {
    return true
  }

  // Bearer token pattern
  if (/^Bearer\s+\S+$/i.test(value)) {
    return true
  }

  // Looks like an API key (long alphanumeric string with possible prefixes)
  if (/^(sk|pk|api|key|token|secret)[-_][A-Za-z0-9]{20,}$/i.test(value)) {
    return true
  }

  // Long base64 encoded string (likely a secret)
  if (/^[A-Za-z0-9+/]{40,}={0,2}$/.test(value)) {
    return true
  }

  return false
}

/**
 * Sanitize a value for logging, removing sensitive data
 *
 * @param value - The value to sanitize
 * @param depth - Current recursion depth (internal use)
 * @returns Sanitized value safe for logging
 */
export function sanitizeValue(value: unknown, depth = 0): unknown {
  // Prevent infinite recursion
  if (depth > MAX_SANITIZE_DEPTH) {
    return '[MAX_DEPTH_EXCEEDED]'
  }

  // Handle null and undefined
  if (value === null || value === undefined) {
    return value
  }

  // Handle primitives
  if (typeof value === 'boolean' || typeof value === 'number') {
    return value
  }

  if (typeof value === 'string') {
    // Check if the string itself looks sensitive
    if (isSensitiveValue(value)) {
      return REDACTED
    }
    // Truncate long strings
    if (value.length > MAX_STRING_LENGTH) {
      return value.substring(0, MAX_STRING_LENGTH) + `... [truncated, total ${value.length} chars]`
    }
    return value
  }

  // Handle arrays
  if (Array.isArray(value)) {
    const sanitized = value.slice(0, MAX_ARRAY_LENGTH).map((item) => sanitizeValue(item, depth + 1))
    if (value.length > MAX_ARRAY_LENGTH) {
      sanitized.push(`... [${value.length - MAX_ARRAY_LENGTH} more items]`)
    }
    return sanitized
  }

  // Handle objects
  if (typeof value === 'object') {
    // Handle special objects
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      }
    }

    if (value instanceof Date) {
      return value.toISOString()
    }

    // Handle plain objects
    const sanitized: Record<string, unknown> = {}
    const entries = Object.entries(value as Record<string, unknown>)

    for (const [key, val] of entries) {
      if (isSensitiveKey(key)) {
        sanitized[key] = REDACTED
      } else {
        sanitized[key] = sanitizeValue(val, depth + 1)
      }
    }

    return sanitized
  }

  // Handle functions (just note their presence)
  if (typeof value === 'function') {
    return '[Function]'
  }

  // Handle symbols
  if (typeof value === 'symbol') {
    return value.toString()
  }

  // Handle bigint
  if (typeof value === 'bigint') {
    return value.toString()
  }

  return String(value)
}

/**
 * Sanitize RPC arguments for logging
 *
 * @param args - The arguments array to sanitize
 * @returns Sanitized arguments safe for logging
 */
export function sanitizeArgs(args: unknown[]): unknown[] {
  return args.map((arg) => sanitizeValue(arg))
}

/**
 * Context for RPC error logging
 */
export interface RPCErrorContext {
  /** RPC method name */
  method: string
  /** Sanitized RPC arguments */
  args?: unknown[]
  /** Correlation ID for request tracing */
  correlationId?: string
  /** Timestamp of the error */
  timestamp: string
  /** Error stack trace */
  stack?: string | undefined
  /** Error code (if RPCError) */
  code?: string
  /** HTTP status (if RPCError) */
  httpStatus?: number
  /** Additional error details */
  details?: Record<string, unknown>
}

/**
 * Build error context for logging
 */
export function buildErrorContext(
  error: unknown,
  method: string,
  args: unknown[],
  correlationId?: string
): RPCErrorContext {
  const context: RPCErrorContext = {
    method,
    args: sanitizeArgs(args),
    timestamp: new Date().toISOString(),
  }

  if (correlationId) {
    context.correlationId = correlationId
  }

  if (error instanceof Error) {
    context.stack = error.stack

    // Check for RPCError properties
    if ('code' in error && typeof (error as { code: unknown }).code === 'string') {
      context.code = (error as { code: string }).code
    }
    if ('httpStatus' in error && typeof (error as { httpStatus: unknown }).httpStatus === 'number') {
      context.httpStatus = (error as { httpStatus: number }).httpStatus
    }
    if ('details' in error && typeof (error as { details: unknown }).details === 'object') {
      context.details = sanitizeValue((error as { details: Record<string, unknown> }).details) as Record<string, unknown>
    }
  }

  return context
}

/**
 * Log an RPC error with full context
 *
 * @param error - The error that occurred
 * @param method - The RPC method that was called
 * @param args - The arguments passed to the method
 * @param correlationId - Optional correlation ID for tracing
 */
export function logRPCError(
  error: unknown,
  method: string,
  args: unknown[],
  correlationId?: string
): void {
  const context = buildErrorContext(error, method, args, correlationId)
  const errorMessage = error instanceof Error ? error.message : String(error)

  logger.error(`RPC error in ${method}: ${errorMessage}`, context)
}

/**
 * Format error context as a string for logging
 * Useful when you want more control over the log format
 */
export function formatErrorContext(context: RPCErrorContext): string {
  const parts: string[] = [
    `method=${context.method}`,
    `timestamp=${context.timestamp}`,
  ]

  if (context.correlationId) {
    parts.push(`correlationId=${context.correlationId}`)
  }

  if (context.code) {
    parts.push(`code=${context.code}`)
  }

  if (context.httpStatus) {
    parts.push(`httpStatus=${context.httpStatus}`)
  }

  if (context.args && context.args.length > 0) {
    try {
      parts.push(`args=${JSON.stringify(context.args)}`)
    } catch {
      parts.push('args=[serialization failed]')
    }
  }

  return parts.join(' ')
}
