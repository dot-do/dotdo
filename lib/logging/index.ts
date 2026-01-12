/**
 * Structured Logging Abstraction
 *
 * Provides a structured logging API that replaces console.log with:
 * - Log levels (debug, info, warn, error)
 * - Structured JSON output
 * - Correlation ID support for request tracing
 * - Child loggers for context inheritance
 *
 * @example
 * ```typescript
 * import { createLogger, LogLevel } from '@/lib/logging'
 *
 * const logger = createLogger({
 *   name: 'my-service',
 *   level: LogLevel.INFO,
 *   context: { service: 'api', version: '1.0.0' }
 * })
 *
 * logger.info('Request received', { requestId: 'req-123' })
 * // Output: {"timestamp":"2024-01-10T12:00:00.000Z","level":"info","name":"my-service","message":"Request received","service":"api","version":"1.0.0","requestId":"req-123"}
 * ```
 */

/**
 * Log levels for controlling output verbosity.
 * Lower numbers are more verbose.
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  SILENT = 4,
}

/**
 * Log entry structure for structured JSON output.
 */
export interface LogEntry {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  name?: string
  error?: {
    name: string
    message: string
    stack?: string
  }
  [key: string]: unknown
}

/**
 * Logger interface for structured logging.
 */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, context?: Record<string, unknown>): void
  child(context: Record<string, unknown>): Logger
}

/**
 * Options for creating a logger instance.
 */
export interface LoggerOptions {
  /** Logger name for identification */
  name?: string
  /** Minimum log level to output */
  level?: LogLevel
  /** Default context to include in all log entries */
  context?: Record<string, unknown>
}

/**
 * Type alias for log context (Record<string, unknown>)
 */
export type LogContext = Record<string, unknown>

/**
 * Level string names for output
 */
const levelNames: Record<number, 'debug' | 'info' | 'warn' | 'error'> = {
  [LogLevel.DEBUG]: 'debug',
  [LogLevel.INFO]: 'info',
  [LogLevel.WARN]: 'warn',
  [LogLevel.ERROR]: 'error',
}

/**
 * Safe JSON stringify that handles circular references
 */
function safeStringify(obj: unknown): string {
  const seen = new WeakSet()
  return JSON.stringify(obj, (_, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]'
      }
      seen.add(value)
    }
    return value
  })
}

/**
 * Serialize an Error object to a plain object for JSON output
 */
function serializeError(error: Error): { name: string; message: string; stack?: string } {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  }
}

/**
 * Process context to handle special values like Error objects
 */
function processContext(context: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(context)) {
    if (value instanceof Error) {
      result[key] = serializeError(value)
    } else {
      result[key] = value
    }
  }
  return result
}

/**
 * Create a structured logger instance.
 *
 * @param options - Logger configuration options
 * @returns A Logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger({
 *   name: 'api',
 *   level: LogLevel.INFO,
 *   context: { service: 'my-service' }
 * })
 *
 * // Create child logger with additional context
 * const authLogger = logger.child({ component: 'auth' })
 * authLogger.info('User logged in', { userId: 123 })
 * ```
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const { name, level = LogLevel.INFO, context = {} } = options

  const log = (logLevel: LogLevel, message: string, callContext?: Record<string, unknown>): void => {
    // Check if this level should be logged
    if (logLevel < level || level === LogLevel.SILENT) {
      return
    }

    // Build log entry
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: levelNames[logLevel]!,
      message,
    }

    // Add name if provided
    if (name) {
      entry.name = name
    }

    // Merge default context
    const processedDefaultContext = processContext(context)
    Object.assign(entry, processedDefaultContext)

    // Merge call-specific context (overrides defaults)
    if (callContext) {
      const processedCallContext = processContext(callContext)
      Object.assign(entry, processedCallContext)
    }

    // Output as JSON
    console.log(safeStringify(entry))
  }

  const logger: Logger = {
    debug(message: string, ctx?: Record<string, unknown>) {
      log(LogLevel.DEBUG, message, ctx)
    },
    info(message: string, ctx?: Record<string, unknown>) {
      log(LogLevel.INFO, message, ctx)
    },
    warn(message: string, ctx?: Record<string, unknown>) {
      log(LogLevel.WARN, message, ctx)
    },
    error(message: string, ctx?: Record<string, unknown>) {
      log(LogLevel.ERROR, message, ctx)
    },
    child(childContext: Record<string, unknown>): Logger {
      return createLogger({
        name,
        level,
        context: { ...context, ...childContext },
      })
    },
  }

  return logger
}

/**
 * Default logger instance for convenience.
 * Use createLogger() for custom configuration.
 */
export const logger = createLogger()
