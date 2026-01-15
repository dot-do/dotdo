/**
 * Structured Logging Abstraction
 *
 * Provides a structured logging API that replaces console.log with:
 * - Log levels (debug, info, warn, error)
 * - Structured JSON output
 * - Correlation ID support for request tracing
 * - Child loggers for context inheritance
 * - Environment variable configuration via LOG_LEVEL
 *
 * @example
 * ```typescript
 * import { createLogger, LogLevel, parseLogLevel } from '@/lib/logging'
 *
 * // Static logger with explicit level
 * const logger = createLogger({
 *   name: 'my-service',
 *   level: LogLevel.INFO,
 *   context: { service: 'api', version: '1.0.0' }
 * })
 *
 * // Logger from environment (Cloudflare Workers)
 * const envLogger = createLogger({
 *   name: 'worker',
 *   level: parseLogLevel(env.LOG_LEVEL), // Reads from wrangler.toml [vars]
 * })
 *
 * logger.info('Request received', { requestId: 'req-123' })
 * // Output: {"timestamp":"2024-01-10T12:00:00.000Z","level":"info","name":"my-service","message":"Request received","service":"api","version":"1.0.0","requestId":"req-123"}
 * ```
 *
 * ## Environment Configuration
 *
 * Set LOG_LEVEL in wrangler.toml:
 * ```toml
 * [vars]
 * LOG_LEVEL = "debug"  # Options: debug, info, warn, error, silent
 * ```
 *
 * Or via wrangler secret for production:
 * ```bash
 * wrangler secret put LOG_LEVEL
 * ```
 */

import { safeStringify as baseSafeStringify, serializeError as baseSerializeError } from '../safe-stringify'

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
 * String representations of log levels for environment variable parsing.
 */
export type LogLevelString = 'debug' | 'info' | 'warn' | 'error' | 'silent'

/**
 * Parse a log level string (from environment variable) to LogLevel enum.
 *
 * This is the primary way to configure log levels from environment variables
 * in Cloudflare Workers, where `process.env` is not available.
 *
 * @param levelStr - The log level string (case-insensitive)
 * @param defaultLevel - Default level if string is invalid or undefined (default: INFO)
 * @returns The corresponding LogLevel enum value
 *
 * @example
 * ```typescript
 * // In a Cloudflare Worker handler
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     const logger = createLogger({
 *       name: 'worker',
 *       level: parseLogLevel(env.LOG_LEVEL),
 *     })
 *     logger.debug('Processing request')
 *   }
 * }
 * ```
 */
export function parseLogLevel(levelStr: string | undefined | null, defaultLevel: LogLevel = LogLevel.INFO): LogLevel {
  if (!levelStr) {
    return defaultLevel
  }

  const normalized = levelStr.toLowerCase().trim()

  switch (normalized) {
    case 'debug':
      return LogLevel.DEBUG
    case 'info':
      return LogLevel.INFO
    case 'warn':
    case 'warning':
      return LogLevel.WARN
    case 'error':
      return LogLevel.ERROR
    case 'silent':
    case 'none':
    case 'off':
      return LogLevel.SILENT
    default:
      // Invalid level string - return default
      return defaultLevel
  }
}

/**
 * Convert LogLevel enum to string representation.
 *
 * @param level - The LogLevel enum value
 * @returns The string representation
 */
export function logLevelToString(level: LogLevel): LogLevelString | 'unknown' {
  switch (level) {
    case LogLevel.DEBUG:
      return 'debug'
    case LogLevel.INFO:
      return 'info'
    case LogLevel.WARN:
      return 'warn'
    case LogLevel.ERROR:
      return 'error'
    case LogLevel.SILENT:
      return 'silent'
    default:
      return 'unknown'
  }
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

// ============================================================================
// Global Log Level Configuration
// ============================================================================

/**
 * Global log level that can be set at runtime.
 * Used by loggers that don't specify an explicit level.
 * Defaults to INFO.
 */
let globalLogLevel: LogLevel = LogLevel.INFO

/**
 * Get the current global log level.
 *
 * @returns The current global log level
 */
export function getGlobalLogLevel(): LogLevel {
  return globalLogLevel
}

/**
 * Set the global log level at runtime.
 *
 * This affects all loggers created after this call that don't specify
 * an explicit level, as well as the default `logger` export.
 *
 * @param level - The new global log level
 *
 * @example
 * ```typescript
 * // In a Durable Object constructor or Worker fetch handler
 * setGlobalLogLevel(parseLogLevel(env.LOG_LEVEL))
 * ```
 */
export function setGlobalLogLevel(level: LogLevel): void {
  globalLogLevel = level
}

/**
 * Initialize global log level from an environment object.
 *
 * This is a convenience function for Cloudflare Workers where
 * environment variables are passed via the env object.
 *
 * @param env - Environment object with optional LOG_LEVEL property
 * @returns The log level that was set
 *
 * @example
 * ```typescript
 * // In worker fetch handler
 * export default {
 *   async fetch(request: Request, env: Env) {
 *     initLogLevelFromEnv(env)
 *     logger.debug('Request received')
 *   }
 * }
 * ```
 */
export function initLogLevelFromEnv(env: { LOG_LEVEL?: string } | undefined | null): LogLevel {
  const level = parseLogLevel(env?.LOG_LEVEL)
  setGlobalLogLevel(level)
  return level
}

// ============================================================================
// Logger Factory with Environment Support
// ============================================================================

/**
 * Environment interface for log level configuration.
 */
export interface LogEnv {
  LOG_LEVEL?: string
  [key: string]: unknown
}

/**
 * Create a logger instance configured from environment variables.
 *
 * This is the recommended way to create loggers in Cloudflare Workers.
 *
 * @param env - Environment object with optional LOG_LEVEL
 * @param options - Additional logger options (name, context)
 * @returns A configured Logger instance
 *
 * @example
 * ```typescript
 * // In a Durable Object
 * class MyDO {
 *   private logger: Logger
 *
 *   constructor(state: DurableObjectState, env: Env) {
 *     this.logger = createLoggerFromEnv(env, { name: 'MyDO' })
 *   }
 *
 *   async fetch(request: Request) {
 *     this.logger.info('Request received', { url: request.url })
 *   }
 * }
 * ```
 */
export function createLoggerFromEnv(
  env: LogEnv | undefined | null,
  options: Omit<LoggerOptions, 'level'> = {}
): Logger {
  return createLogger({
    ...options,
    level: parseLogLevel(env?.LOG_LEVEL),
  })
}

// ============================================================================
// Default Logger
// ============================================================================

/**
 * Create a logger that respects the global log level.
 *
 * Unlike createLogger() which captures the level at creation time,
 * this creates a logger that checks the global level on each log call.
 */
function createGlobalLevelLogger(name?: string): Logger {
  const context: Record<string, unknown> = {}

  const log = (logLevel: LogLevel, message: string, callContext?: Record<string, unknown>): void => {
    // Check against global level on each call
    if (logLevel < globalLogLevel || globalLogLevel === LogLevel.SILENT) {
      return
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: levelNames[logLevel]!,
      message,
    }

    if (name) {
      entry.name = name
    }

    const processedDefaultContext = processContext(context)
    Object.assign(entry, processedDefaultContext)

    if (callContext) {
      const processedCallContext = processContext(callContext)
      Object.assign(entry, processedCallContext)
    }

    console.log(safeStringify(entry))
  }

  return {
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
      // Child loggers inherit the global level behavior
      const childLogger = createGlobalLevelLogger(name)
      // Merge context into child
      Object.assign(context, childContext)
      return childLogger
    },
  }
}

/**
 * Default logger instance that respects global log level.
 *
 * This logger checks the global log level on each call, so you can
 * change the level at runtime with setGlobalLogLevel() and it will
 * take effect immediately.
 *
 * @example
 * ```typescript
 * import { logger, setGlobalLogLevel, LogLevel } from '@/lib/logging'
 *
 * // Initially, only info and above are logged
 * logger.debug('This will not be logged')
 * logger.info('This will be logged')
 *
 * // Enable debug logging
 * setGlobalLogLevel(LogLevel.DEBUG)
 * logger.debug('Now this will be logged')
 * ```
 */
export const logger = createGlobalLevelLogger('dotdo')
