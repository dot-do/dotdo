/**
 * Error Context Preservation Module
 *
 * Provides specialized error classes and utilities for preserving
 * actionable context throughout error chains:
 *
 * - FileError: File operations with path context
 * - NetworkError: HTTP operations with URL/method context
 * - RetryError: Retry operations with attempt context
 * - PipelineError: Pipeline operations with stage context
 *
 * Also provides utilities for:
 * - formatErrorContext: Format context for human-readable output
 * - redactSensitiveContext: Remove sensitive data from context
 *
 * @packageDocumentation
 */

import {
  BashxError,
  type ErrorCode,
  type ErrorContext,
} from './bashx-error.js'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for formatting error context.
 */
export interface FormatOptions {
  /** Maximum length for string values before truncation */
  maxValueLength?: number
  /** Include timestamp in output */
  includeTimestamp?: boolean
  /** Indentation string */
  indent?: string
}

/**
 * List of field names considered sensitive.
 */
export type SensitiveFields = string[]

/**
 * Default sensitive field names that will be redacted.
 */
export const DEFAULT_SENSITIVE_FIELDS: SensitiveFields = [
  'password',
  'secret',
  'token',
  'apiKey',
  'api_key',
  'apikey',
  'authorization',
  'Authorization',
  'auth',
  // Note: 'credential' and 'credentials' are NOT included here because
  // they often contain nested objects where we want to preserve structure
  // while only redacting the actual secret values (e.g., password inside)
  'private_key',
  'privateKey',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'bearer',
]

// ============================================================================
// FileError
// ============================================================================

/**
 * Options for FileError.
 */
export interface FileErrorOptions {
  /** The file path involved in the operation */
  path: string
  /** The operation being performed (read, write, delete, etc.) */
  operation: 'read' | 'write' | 'delete' | 'stat' | 'mkdir' | 'rmdir' | 'list' | 'chmod' | 'chown' | 'link' | 'copy' | 'move'
  /** Error number code (ENOENT, EACCES, etc.) */
  errno?: string
  /** Additional context */
  context?: ErrorContext
  /** Original error */
  cause?: Error
}

/**
 * Retryable errno codes - these indicate temporary conditions.
 */
const RETRYABLE_ERRNO = new Set([
  'EAGAIN',       // Resource temporarily unavailable
  'EBUSY',        // Device or resource busy
  'ECONNRESET',   // Connection reset
  'EINTR',        // Interrupted system call
  'EMFILE',       // Too many open files
  'ENFILE',       // File table overflow
  'ENOBUFS',      // No buffer space available
  'ENOMEM',       // Out of memory
  'ENOSPC',       // No space left on device (may be cleared)
  'ETIMEDOUT',    // Connection timed out
])

/**
 * Error thrown when file operations fail.
 *
 * Includes file path, operation type, and errno for actionable debugging.
 *
 * @example
 * ```typescript
 * throw new FileError('File not found', {
 *   path: '/config/settings.json',
 *   operation: 'read',
 *   errno: 'ENOENT',
 * })
 * ```
 */
export class FileError extends BashxError {
  readonly path: string
  readonly operation: string
  readonly errno?: string

  constructor(message: string, options: FileErrorOptions) {
    const hint = FileError.generateHint(options)
    const retryable = options.errno ? RETRYABLE_ERRNO.has(options.errno) : false

    super(message, {
      code: 'FILE_ERROR' as ErrorCode,
      retryable,
      hint,
      context: {
        path: options.path,
        operation: options.operation,
        errno: options.errno,
        ...options.context,
      },
      cause: options.cause,
    })

    this.name = 'FileError'
    this.path = options.path
    this.operation = options.operation
    this.errno = options.errno
  }

  private static generateHint(options: FileErrorOptions): string {
    const { path, operation, errno } = options

    if (errno === 'ENOENT') {
      return `File not found: ${path}. Verify the file exists and the path is correct.`
    }
    if (errno === 'EACCES') {
      return `Permission denied: ${path}. Check file permissions for ${operation} access.`
    }
    if (errno === 'EISDIR') {
      return `Expected file but got directory: ${path}. Use a directory operation instead.`
    }
    if (errno === 'ENOTDIR') {
      return `Expected directory but got file: ${path}. Use a file operation instead.`
    }
    if (errno === 'EEXIST') {
      return `File already exists: ${path}. Use overwrite option or choose a different path.`
    }
    if (errno === 'ENOTEMPTY') {
      return `Directory not empty: ${path}. Use recursive deletion to remove non-empty directories.`
    }
    if (errno === 'EMFILE' || errno === 'ENFILE') {
      return `Too many open files. Close unused file handles and retry.`
    }
    if (errno === 'ENOSPC') {
      return `No space left on device. Free up disk space and retry.`
    }

    return `File ${operation} failed on ${path}.`
  }
}

// ============================================================================
// NetworkError (bashx-specific, not git remote)
// ============================================================================

/**
 * Options for NetworkError.
 */
export interface NetworkErrorOptions {
  /** The URL of the request */
  url: string
  /** HTTP method used */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS'
  /** HTTP status code if available */
  statusCode?: number
  /** Request body size in bytes */
  bodySize?: number
  /** Error number code (ECONNRESET, etc.) */
  errno?: string
  /** Response headers */
  headers?: Record<string, string>
  /** Additional context */
  context?: ErrorContext
  /** Original error */
  cause?: Error
}

/**
 * Retryable network errno codes.
 */
const RETRYABLE_NETWORK_ERRNO = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'ECONNREFUSED',
  'ENETUNREACH',
  'EPIPE',
  'EAI_AGAIN',
  'EHOSTUNREACH',
])

/**
 * Error thrown when network operations fail.
 *
 * Includes URL, method, and status code for actionable debugging.
 *
 * @example
 * ```typescript
 * throw new NetworkError('Connection refused', {
 *   url: 'https://api.example.com/data',
 *   method: 'GET',
 *   errno: 'ECONNREFUSED',
 * })
 * ```
 */
export class NetworkError extends BashxError {
  readonly url: string
  readonly method: string
  readonly statusCode?: number

  constructor(message: string, options: NetworkErrorOptions) {
    const hint = NetworkError.generateHint(options)
    const retryable = NetworkError.isRetryable(options)

    super(message, {
      code: 'NETWORK_ERROR',
      retryable,
      hint,
      context: {
        url: options.url,
        method: options.method,
        statusCode: options.statusCode,
        bodySize: options.bodySize,
        errno: options.errno,
        ...options.context,
      },
      cause: options.cause,
    })

    this.name = 'NetworkError'
    this.url = options.url
    this.method = options.method
    this.statusCode = options.statusCode
  }

  private static isRetryable(options: NetworkErrorOptions): boolean {
    // Network errors are retryable
    if (options.errno && RETRYABLE_NETWORK_ERRNO.has(options.errno)) {
      return true
    }
    // 5xx errors are retryable
    if (options.statusCode && options.statusCode >= 500) {
      return true
    }
    // 429 (rate limit) is retryable
    if (options.statusCode === 429) {
      return true
    }
    // 4xx errors are not retryable
    if (options.statusCode && options.statusCode >= 400 && options.statusCode < 500) {
      return false
    }
    return false
  }

  private static generateHint(options: NetworkErrorOptions): string {
    const { url, method, statusCode, errno } = options

    if (errno === 'ECONNREFUSED') {
      return `Connection refused to ${url}. Check if the server is running.`
    }
    if (errno === 'ECONNRESET') {
      return `Connection reset by ${url}. Retry the request.`
    }
    if (errno === 'ETIMEDOUT') {
      return `Request to ${url} timed out. Check network connectivity or increase timeout.`
    }
    if (statusCode === 401) {
      return `Authentication required for ${method} ${url}. Provide valid credentials.`
    }
    if (statusCode === 403) {
      return `Access forbidden to ${url}. Check permissions or authentication.`
    }
    if (statusCode === 404) {
      return `Resource not found: ${url}. Verify the URL is correct.`
    }
    if (statusCode === 429) {
      return `Rate limit exceeded for ${url}. Wait before retrying.`
    }
    if (statusCode && statusCode >= 500) {
      return `Server error (${statusCode}) at ${url}. The server may be temporarily unavailable.`
    }

    return `${method} request to ${url} failed.`
  }
}

// ============================================================================
// RetryError
// ============================================================================

/**
 * Options for RetryError.
 */
export interface RetryErrorOptions {
  /** Current attempt number (1-indexed) */
  attempt: number
  /** Maximum number of attempts */
  maxAttempts: number
  /** Name of the operation being retried */
  operation: string
  /** Timestamps of each attempt */
  attemptTimestamps?: Date[]
  /** Additional context */
  context?: ErrorContext
  /** Original error from the last attempt */
  cause?: Error
}

/**
 * Error thrown when retry attempts are exhausted.
 *
 * Includes attempt count and operation details for debugging retry logic.
 *
 * @example
 * ```typescript
 * throw new RetryError('Operation failed after retries', {
 *   attempt: 3,
 *   maxAttempts: 3,
 *   operation: 'fetch-data',
 * })
 * ```
 */
export class RetryError extends BashxError {
  readonly attempt: number
  readonly maxAttempts: number
  readonly operation: string

  constructor(message: string, options: RetryErrorOptions) {
    const exhausted = options.attempt >= options.maxAttempts
    const hint = exhausted
      ? `Operation '${options.operation}' failed after ${options.attempt} of ${options.maxAttempts} attempts. Consider increasing maxAttempts or investigating the underlying error.`
      : `Attempt ${options.attempt} of ${options.maxAttempts} for '${options.operation}' failed.`

    super(message, {
      code: exhausted ? 'RETRY_EXHAUSTED' as ErrorCode : 'EXECUTION_ERROR',
      retryable: !exhausted,
      hint,
      context: {
        attempt: options.attempt,
        maxAttempts: options.maxAttempts,
        operation: options.operation,
        attemptTimestamps: options.attemptTimestamps,
        ...options.context,
      },
      cause: options.cause,
    })

    this.name = 'RetryError'
    this.attempt = options.attempt
    this.maxAttempts = options.maxAttempts
    this.operation = options.operation
  }
}

// ============================================================================
// PipelineError
// ============================================================================

/**
 * Options for PipelineError.
 */
export interface PipelineErrorOptions {
  /** Index of the failed stage (0-indexed) */
  stageIndex: number
  /** The command at the failed stage */
  stageCommand: string
  /** Full pipeline command */
  pipeline: string
  /** Total number of stages */
  totalStages?: number
  /** Commands of successfully completed stages */
  completedStages?: string[]
  /** Size of output from previous stage */
  previousOutputSize?: number
  /** Additional context */
  context?: ErrorContext
  /** Original error from the failed stage */
  cause?: Error
}

/**
 * Error thrown when a pipeline stage fails.
 *
 * Includes stage index, command, and pipeline details for debugging.
 *
 * @example
 * ```typescript
 * throw new PipelineError('Stage failed', {
 *   stageIndex: 2,
 *   stageCommand: 'grep pattern',
 *   pipeline: 'cat file | sort | grep pattern',
 * })
 * ```
 */
export class PipelineError extends BashxError {
  readonly stageIndex: number
  readonly stageCommand: string
  readonly pipeline: string

  constructor(message: string, options: PipelineErrorOptions) {
    const stageNum = options.stageIndex + 1  // Human-readable (1-indexed)
    const totalStages = options.totalStages ?? options.pipeline.split('|').length
    const hint = `Pipeline failed at stage ${stageNum} of ${totalStages}: '${options.stageCommand}'. Check the command syntax and input from previous stage.`

    super(message, {
      code: 'PIPELINE_ERROR' as ErrorCode,
      retryable: false,
      hint,
      context: {
        stageIndex: options.stageIndex,
        stageCommand: options.stageCommand,
        pipeline: options.pipeline,
        totalStages,
        completedStages: options.completedStages,
        previousOutputSize: options.previousOutputSize,
        ...options.context,
      },
      cause: options.cause,
    })

    this.name = 'PipelineError'
    this.stageIndex = options.stageIndex
    this.stageCommand = options.stageCommand
    this.pipeline = options.pipeline
  }
}

// ============================================================================
// formatErrorContext
// ============================================================================

/**
 * Format error context as a human-readable string.
 *
 * @param context - The error context to format
 * @param options - Formatting options
 * @returns Formatted context string
 *
 * @example
 * ```typescript
 * const formatted = formatErrorContext({
 *   command: 'cat file.txt',
 *   tier: 1,
 * })
 * // "command: cat file.txt\ntier: 1"
 * ```
 */
export function formatErrorContext(
  context: ErrorContext,
  options: FormatOptions = {}
): string {
  const {
    maxValueLength = 500,
    indent = '',
  } = options

  const lines: string[] = []

  for (const [key, value] of Object.entries(context)) {
    if (value === undefined) {
      continue
    }

    const formattedValue = formatValue(value, maxValueLength)
    lines.push(`${indent}${key}: ${formattedValue}`)
  }

  return lines.join('\n')
}

/**
 * Format a single value for display.
 */
function formatValue(value: unknown, maxLength: number): string {
  if (value === null) {
    return 'null'
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (Array.isArray(value)) {
    const items = value.map(v => formatValue(v, maxLength))
    const joined = `[${items.join(', ')}]`
    return truncate(joined, maxLength)
  }

  if (typeof value === 'object') {
    try {
      const json = JSON.stringify(value, null, 2)
      return truncate(json, maxLength)
    } catch {
      return '[object]'
    }
  }

  if (typeof value === 'string') {
    return truncate(value, maxLength)
  }

  return String(value)
}

/**
 * Truncate a string to max length with ellipsis.
 */
function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) {
    return str
  }
  return str.slice(0, maxLength - 3) + '...'
}

// ============================================================================
// redactSensitiveContext
// ============================================================================

/**
 * Redact sensitive data from error context.
 *
 * Creates a new context object with sensitive fields replaced by '[REDACTED]'.
 * Does not modify the original context.
 *
 * @param context - The error context to redact
 * @param sensitiveFields - Additional field names to redact
 * @returns New context with sensitive data redacted
 *
 * @example
 * ```typescript
 * const redacted = redactSensitiveContext({
 *   url: 'https://api.example.com',
 *   headers: { Authorization: 'Bearer secret' },
 * })
 * // headers.Authorization will be '[REDACTED]'
 * ```
 */
export function redactSensitiveContext(
  context: ErrorContext,
  sensitiveFields: SensitiveFields = []
): ErrorContext {
  const allSensitiveFields = new Set([...DEFAULT_SENSITIVE_FIELDS, ...sensitiveFields])
  return redactObject(context, allSensitiveFields) as ErrorContext
}

/**
 * Recursively redact sensitive fields from an object.
 */
function redactObject(obj: unknown, sensitiveFields: Set<string>): unknown {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (Array.isArray(obj)) {
    return obj.map(item => redactObject(item, sensitiveFields))
  }

  if (typeof obj === 'string') {
    return redactString(obj)
  }

  if (typeof obj !== 'object') {
    return obj
  }

  const result: Record<string, unknown> = {}
  const record = obj as Record<string, unknown>

  for (const [key, value] of Object.entries(record)) {
    // Check if key matches sensitive field names (case-insensitive)
    const isFieldSensitive = isSensitiveField(key, sensitiveFields)

    // Special handling for header arrays with name/value structure
    if (key === 'headers' && Array.isArray(value)) {
      result[key] = (value as Array<{ name: string; value: unknown }>).map(header => {
        if (header && typeof header === 'object' && 'name' in header && 'value' in header) {
          if (isSensitiveField(header.name as string, sensitiveFields)) {
            return { ...header, value: '[REDACTED]' }
          }
        }
        return redactObject(header, sensitiveFields)
      })
      continue
    }

    if (isFieldSensitive) {
      result[key] = '[REDACTED]'
    } else if (typeof value === 'string') {
      result[key] = redactString(value)
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactObject(value, sensitiveFields)
    } else {
      result[key] = value
    }
  }

  return result
}

/**
 * Check if a field name indicates sensitive data.
 */
function isSensitiveField(fieldName: string, sensitiveFields: Set<string>): boolean {
  const lowerName = fieldName.toLowerCase()
  for (const field of sensitiveFields) {
    if (lowerName === field.toLowerCase()) {
      return true
    }
    if (lowerName.includes(field.toLowerCase())) {
      return true
    }
  }
  return false
}

/**
 * Redact sensitive patterns in strings.
 */
function redactString(str: string): string {
  // Redact Bearer tokens
  str = str.replace(/Bearer\s+[^\s\n]+/gi, 'Bearer [REDACTED]')

  // Redact Basic auth
  str = str.replace(/Basic\s+[^\s\n]+/gi, 'Basic [REDACTED]')

  // Redact token= query parameters
  str = str.replace(/(\btoken=)[^&\s]+/gi, '$1[REDACTED]')

  // Redact api_key= query parameters
  str = str.replace(/(\bapi_key=)[^&\s]+/gi, '$1[REDACTED]')

  // Redact apikey= query parameters
  str = str.replace(/(\bapikey=)[^&\s]+/gi, '$1[REDACTED]')

  // Redact access_token= query parameters
  str = str.replace(/(\baccess_token=)[^&\s]+/gi, '$1[REDACTED]')

  return str
}
