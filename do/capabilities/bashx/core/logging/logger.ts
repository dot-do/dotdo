/**
 * Logger Interface and Factory
 *
 * A structured logging interface that supports log levels, filtering, and context.
 * Designed for use in both browser and Node.js environments.
 *
 * @packageDocumentation
 */

// ============================================================================
// Log Level Enum
// ============================================================================

/**
 * Log levels in order of increasing severity.
 * Used for filtering log messages.
 */
export enum LogLevel {
  /** Detailed debugging information */
  DEBUG = 0,
  /** General information about program execution */
  INFO = 1,
  /** Warning messages for potential issues */
  WARN = 2,
  /** Error messages for failures */
  ERROR = 3,
}

// ============================================================================
// Types
// ============================================================================

/**
 * A single log entry containing all metadata.
 */
export interface LogEntry {
  /** Log level as a string ('debug', 'info', 'warn', 'error') */
  level: 'debug' | 'info' | 'warn' | 'error'
  /** The log message */
  message: string
  /** Optional contextual data */
  context?: Record<string, unknown>
  /** Timestamp when the log was created */
  timestamp: Date
}

/**
 * Function type for outputting log entries.
 * Allows custom output handling (e.g., console, file, remote service).
 */
export type OutputFunction = (entry: LogEntry) => void

/**
 * Options for creating a logger instance.
 */
export interface LoggerOptions {
  /** Minimum log level to output (default: DEBUG) */
  level?: LogLevel
  /** Custom output function (default: console-based output) */
  output?: OutputFunction
}

/**
 * Logger interface with methods for each log level.
 */
export interface Logger {
  /** Log a debug message with optional context */
  debug(message: string, context?: Record<string, unknown>): void
  /** Log an info message with optional context */
  info(message: string, context?: Record<string, unknown>): void
  /** Log a warning message with optional context */
  warn(message: string, context?: Record<string, unknown>): void
  /** Log an error message with optional context */
  error(message: string, context?: Record<string, unknown>): void
}

// ============================================================================
// Default Output
// ============================================================================

/**
 * Default console-based output function.
 */
const defaultOutput: OutputFunction = (entry: LogEntry) => {
  const { level, message, context, timestamp } = entry
  const ts = timestamp.toISOString()
  const ctx = context ? ` ${JSON.stringify(context)}` : ''

  switch (level) {
    case 'debug':
      console.debug(`[${ts}] DEBUG: ${message}${ctx}`)
      break
    case 'info':
      console.info(`[${ts}] INFO: ${message}${ctx}`)
      break
    case 'warn':
      console.warn(`[${ts}] WARN: ${message}${ctx}`)
      break
    case 'error':
      console.error(`[${ts}] ERROR: ${message}${ctx}`)
      break
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new logger instance.
 *
 * @param options - Logger configuration options
 * @returns A Logger instance with debug, info, warn, and error methods
 *
 * @example
 * ```typescript
 * // Basic usage
 * const logger = createLogger()
 * logger.info('Application started')
 *
 * // With level filtering
 * const prodLogger = createLogger({ level: LogLevel.WARN })
 * prodLogger.debug('This will not be output')
 * prodLogger.warn('This will be output')
 *
 * // With custom output
 * const customLogger = createLogger({
 *   output: (entry) => sendToLogService(entry)
 * })
 * ```
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const { level = LogLevel.DEBUG, output = defaultOutput } = options

  const levelNames: Record<LogLevel, 'debug' | 'info' | 'warn' | 'error'> = {
    [LogLevel.DEBUG]: 'debug',
    [LogLevel.INFO]: 'info',
    [LogLevel.WARN]: 'warn',
    [LogLevel.ERROR]: 'error',
  }

  const createLogMethod = (methodLevel: LogLevel) => {
    return (message: string, context?: Record<string, unknown>): void => {
      // Filter by log level
      if (methodLevel < level) {
        return
      }

      const entry: LogEntry = {
        level: levelNames[methodLevel],
        message,
        context,
        timestamp: new Date(),
      }

      output(entry)
    }
  }

  return {
    debug: createLogMethod(LogLevel.DEBUG),
    info: createLogMethod(LogLevel.INFO),
    warn: createLogMethod(LogLevel.WARN),
    error: createLogMethod(LogLevel.ERROR),
  }
}
