/**
 * @module rpc.do/logger
 *
 * Structured logging for rpc.do
 *
 * Provides lightweight, zero-dependency structured JSON logging with:
 * - Log levels (debug, info, warn, error)
 * - Correlation ID propagation for request tracing
 * - Child loggers with inherited context
 * - Request/response logging helpers
 * - Timing utilities
 * - Environment variable configuration
 *
 * @example Basic usage
 * ```typescript
 * import { createLogger, defaultLogger } from 'rpc.do/logger'
 *
 * // Use default logger
 * defaultLogger.info('Server started', { port: 3000 })
 *
 * // Create custom logger
 * const logger = createLogger({
 *   level: 'debug',
 *   correlationId: 'req-123',
 * })
 *
 * logger.debug('Processing request')
 * logger.info('Request complete', { status: 200 })
 * ```
 *
 * @example Child loggers
 * ```typescript
 * const baseLogger = createLogger()
 * const requestLogger = baseLogger.child({ requestId: 'abc', correlationId: 'corr-123' })
 *
 * requestLogger.info('Handling request')
 * requestLogger.info('Request complete', { durationMs: 42 })
 * ```
 *
 * @packageDocumentation
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Log levels in order of verbosity
 */
export const LogLevel = {
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
} as const

/**
 * Log level type derived from the LogLevel constant.
 *
 * Valid values are: 'debug', 'info', 'warn', 'error'
 *
 * @example
 * ```typescript
 * import type { LogLevelType } from 'rpc.do'
 *
 * const level: LogLevelType = 'info'
 * ```
 */
export type LogLevelType = (typeof LogLevel)[keyof typeof LogLevel]

/**
 * Numeric priority for log levels (lower = more verbose)
 */
const LOG_LEVEL_PRIORITY: Record<LogLevelType, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

/**
 * Structured log entry
 */
export interface LogEntry {
  /** ISO 8601 timestamp */
  timestamp: string
  /** Log level */
  level: LogLevelType
  /** Log message */
  message: string
  /** Correlation ID for request tracing */
  correlationId?: string
  /** Additional context data */
  context?: Record<string, unknown>
}

/**
 * Logger options
 */
export interface LoggerOptions {
  /** Minimum log level to output (default: 'info') */
  level?: LogLevelType | undefined
  /** Correlation ID for all log entries */
  correlationId?: string | undefined
  /** Whether the logger is enabled (default: true) */
  enabled?: boolean | undefined
  /** Custom output function (receives LogEntry) */
  output?: ((entry: LogEntry) => void) | undefined
}

/**
 * Context passed when creating a child logger or logging
 */
export interface LogContext extends Record<string, unknown> {
  /** Override correlation ID for this log entry or child */
  correlationId?: string
}

/**
 * Logger interface
 */
export interface Logger {
  /** Log at DEBUG level */
  debug(message: string, context?: LogContext): void
  /** Log at INFO level */
  info(message: string, context?: LogContext): void
  /** Log at WARN level */
  warn(message: string, context?: LogContext): void
  /** Log at ERROR level */
  error(message: string, context?: LogContext): void
  /** Create a child logger with inherited options and additional context */
  child(context: LogContext): Logger
  /** Create a log entry without outputting (for testing or custom processing) */
  createEntry(level: LogLevelType, message: string, context?: LogContext): LogEntry
  /** Log an HTTP request */
  logRequest(method: string, url: string, body?: unknown): void
  /** Log an HTTP response */
  logResponse(status: number, body?: unknown, durationMs?: number): void
  /** Start a timer, returns function that returns elapsed ms */
  startTimer(): () => number
  /** Log timing information */
  logTiming(label: string, durationMs: number): void
  /** Execute async operation and log timing */
  withTiming<T>(label: string, operation: () => Promise<T>): Promise<T>
}

// ============================================================================
// Default Output Functions
// ============================================================================

/**
 * Default output function - outputs to appropriate console method
 */
function defaultOutput(entry: LogEntry): void {
  const formatted = JSON.stringify(entry)
  switch (entry.level) {
    case 'debug':
      console.debug(formatted)
      break
    case 'info':
      console.log(formatted)
      break
    case 'warn':
      console.warn(formatted)
      break
    case 'error':
      console.error(formatted)
      break
  }
}

// ============================================================================
// Logger Implementation
// ============================================================================

/**
 * Create a structured logger instance.
 *
 * Creates a new logger with configurable log level, correlation ID support,
 * and customizable output. The logger provides methods for debug, info, warn,
 * and error logging, plus utilities for timing and request/response logging.
 *
 * @param options - Configuration options for the logger
 * @returns A Logger instance with all logging methods
 *
 * @example Basic usage
 * ```typescript
 * import { createLogger } from 'rpc.do'
 *
 * const logger = createLogger({ level: 'debug' })
 * logger.info('Server started', { port: 3000 })
 * logger.debug('Processing request', { id: 'req-123' })
 * ```
 *
 * @example With correlation ID
 * ```typescript
 * const logger = createLogger({
 *   level: 'info',
 *   correlationId: 'request-abc-123',
 * })
 *
 * // All log entries will include the correlation ID
 * logger.info('Handling request')
 * logger.info('Request complete', { status: 200 })
 * ```
 *
 * @example With custom output
 * ```typescript
 * const entries: LogEntry[] = []
 * const logger = createLogger({
 *   output: (entry) => entries.push(entry),
 * })
 * ```
 *
 * @see {@link Logger} for the logger interface
 * @see {@link LoggerOptions} for configuration options
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? 'info'
  const correlationId = options.correlationId
  const enabled = options.enabled ?? true
  const output = options.output ?? defaultOutput
  const inheritedContext: Record<string, unknown> = {}

  function shouldLog(entryLevel: LogLevelType): boolean {
    if (!enabled) return false
    return LOG_LEVEL_PRIORITY[entryLevel] >= LOG_LEVEL_PRIORITY[level]
  }

  function createEntry(
    entryLevel: LogLevelType,
    message: string,
    context?: LogContext
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: entryLevel,
      message,
    }

    // Determine correlation ID (context > options)
    const entryCorrelationId = context?.correlationId ?? correlationId
    if (entryCorrelationId) {
      entry.correlationId = entryCorrelationId
    }

    // Build context (exclude correlationId from context object)
    const mergedContext: Record<string, unknown> = { ...inheritedContext }
    if (context) {
      for (const [key, value] of Object.entries(context)) {
        if (key !== 'correlationId') {
          mergedContext[key] = value
        }
      }
    }

    if (Object.keys(mergedContext).length > 0) {
      entry.context = mergedContext
    }

    return entry
  }

  function log(entryLevel: LogLevelType, message: string, context?: LogContext): void {
    if (!shouldLog(entryLevel)) return
    const entry = createEntry(entryLevel, message, context)
    output(entry)
  }

  const logger: Logger = {
    debug(message: string, context?: LogContext): void {
      log('debug', message, context)
    },

    info(message: string, context?: LogContext): void {
      log('info', message, context)
    },

    warn(message: string, context?: LogContext): void {
      log('warn', message, context)
    },

    error(message: string, context?: LogContext): void {
      log('error', message, context)
    },

    child(childContext: LogContext): Logger {
      // Extract correlationId from context for child options
      const childCorrelationId = childContext.correlationId ?? correlationId

      // Merge inherited context with child context (excluding correlationId)
      const newInheritedContext: Record<string, unknown> = { ...inheritedContext }
      for (const [key, value] of Object.entries(childContext)) {
        if (key !== 'correlationId') {
          newInheritedContext[key] = value
        }
      }

      // Create child logger with merged options
      const childLogger = createLogger({
        level,
        correlationId: childCorrelationId,
        enabled,
        output,
      })

      // Copy inherited context to child (via closure)
      // This is a bit of a hack - we need to set the inherited context on the child
      // We'll do this by creating a wrapper that merges context
      const wrappedChild: Logger = {
        debug(message: string, ctx?: LogContext): void {
          childLogger.debug(message, { ...newInheritedContext, ...ctx })
        },
        info(message: string, ctx?: LogContext): void {
          childLogger.info(message, { ...newInheritedContext, ...ctx })
        },
        warn(message: string, ctx?: LogContext): void {
          childLogger.warn(message, { ...newInheritedContext, ...ctx })
        },
        error(message: string, ctx?: LogContext): void {
          childLogger.error(message, { ...newInheritedContext, ...ctx })
        },
        child(ctx: LogContext): Logger {
          const mergedCtx = { ...newInheritedContext, ...ctx }
          return childLogger.child(mergedCtx)
        },
        createEntry(lvl: LogLevelType, msg: string, ctx?: LogContext): LogEntry {
          return childLogger.createEntry(lvl, msg, { ...newInheritedContext, ...ctx })
        },
        logRequest(method: string, url: string, body?: unknown): void {
          wrappedChild.debug(`${method} ${url}`, {
            method,
            url,
            ...(body !== undefined ? { body } : {}),
          })
        },
        logResponse(status: number, body?: unknown, durationMs?: number): void {
          wrappedChild.debug(`Response ${status}`, {
            status,
            ...(body !== undefined ? { body } : {}),
            ...(durationMs !== undefined ? { durationMs } : {}),
          })
        },
        startTimer(): () => number {
          const start = performance.now()
          return () => Math.round(performance.now() - start)
        },
        logTiming(label: string, durationMs: number): void {
          wrappedChild.debug(`Timing: ${label}`, { durationMs })
        },
        async withTiming<T>(label: string, operation: () => Promise<T>): Promise<T> {
          const timer = wrappedChild.startTimer()
          const result = await operation()
          wrappedChild.logTiming(label, timer())
          return result
        },
      }

      return wrappedChild
    },

    createEntry,

    logRequest(method: string, url: string, body?: unknown): void {
      logger.debug(`${method} ${url}`, {
        method,
        url,
        ...(body !== undefined ? { body } : {}),
      })
    },

    logResponse(status: number, body?: unknown, durationMs?: number): void {
      logger.debug(`Response ${status}`, {
        status,
        ...(body !== undefined ? { body } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
      })
    },

    startTimer(): () => number {
      const start = performance.now()
      return () => Math.round(performance.now() - start)
    },

    logTiming(label: string, durationMs: number): void {
      logger.debug(`Timing: ${label}`, { durationMs })
    },

    async withTiming<T>(label: string, operation: () => Promise<T>): Promise<T> {
      const timer = logger.startTimer()
      const result = await operation()
      logger.logTiming(label, timer())
      return result
    },
  }

  return logger
}

// ============================================================================
// CLI Integration
// ============================================================================

/**
 * CLI options for creating a logger
 */
export interface CLILoggerOptions {
  /** Enable verbose/debug logging */
  verbose?: boolean | undefined
  /** Quiet mode - only warnings and errors */
  quiet?: boolean | undefined
  /** Custom output function */
  output?: ((entry: LogEntry) => void) | undefined
}

/**
 * Create a logger from CLI options.
 *
 * Convenience function that creates a logger configured based on common CLI flags.
 * Maps --verbose to 'debug' level and --quiet to 'warn' level.
 *
 * @param options - CLI options for verbose/quiet modes
 * @returns A Logger instance configured for CLI usage
 *
 * @example Basic CLI integration
 * ```typescript
 * import { createLoggerFromCLI } from 'rpc.do'
 *
 * // In your CLI command handler
 * const logger = createLoggerFromCLI({
 *   verbose: options.verbose,
 *   quiet: options.quiet,
 * })
 *
 * logger.info('Processing file', { file: 'input.txt' })
 * logger.debug('Detailed info') // Only shown with --verbose
 * ```
 *
 * @see {@link createLogger} for full logger configuration
 * @see {@link CLILoggerOptions} for available options
 */
export function createLoggerFromCLI(options: CLILoggerOptions = {}): Logger {
  let level: LogLevelType = 'info'

  if (options.verbose) {
    level = 'debug'
  } else if (options.quiet) {
    level = 'warn'
  }

  return createLogger({
    level,
    output: options.output,
  })
}

// ============================================================================
// Environment Variable Support
// ============================================================================

/**
 * Get log level from environment variables
 *
 * Checks (in order of priority):
 * - RPC_DO_LOG_LEVEL (debug, info, warn, error)
 * - DEBUG=rpc.do or DEBUG=rpc.do:* or DEBUG=* -> debug
 *
 * @returns Log level from environment, defaults to 'info'
 */
export function getLogLevelFromEnv(): LogLevelType {
  // Check RPC_DO_LOG_LEVEL first
  const explicitLevel = process.env['RPC_DO_LOG_LEVEL']
  if (explicitLevel) {
    const normalized = explicitLevel.toLowerCase()
    if (normalized === 'debug' || normalized === 'info' || normalized === 'warn' || normalized === 'error') {
      return normalized
    }
  }

  // Check DEBUG env var
  const debugEnv = process.env['DEBUG'] ?? ''
  if (debugEnv === 'rpc.do' || debugEnv.startsWith('rpc.do:') || debugEnv === '*') {
    return 'debug'
  }

  return 'info'
}

// ============================================================================
// Default Logger Instance
// ============================================================================

/**
 * Default logger instance
 *
 * Uses environment variables for configuration on first access.
 * For request-scoped logging, create a new logger with createLogger().
 */
export const defaultLogger: Logger = createLogger({
  level: getLogLevelFromEnv(),
})
