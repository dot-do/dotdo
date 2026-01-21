// Structured Logging for rpc.do CLI
// Provides JSON-formatted logging with levels, correlation ID propagation, and request timing

/**
 * Log levels in order of severity (lower = more verbose)
 *
 * DEBUG  (0) - Everything: detailed internal state, raw request/response bodies
 * VERBOSE (1) - Helpful detail: request URLs, response status, timing info
 * INFO/NORMAL (2) - Default: operation results only
 * WARN (3) - Warnings and errors only
 * ERROR (4) - Errors only
 * SILENT (5) - No output
 */
export enum LogLevel {
  DEBUG = 0,    // Most verbose - all debug info including raw data
  VERBOSE = 1,  // Request/response info, timing, but not raw bodies
  INFO = 2,     // Normal output - just results
  WARN = 3,     // Warnings and errors
  ERROR = 4,    // Errors only
  SILENT = 5,   // No output
  // Alias for default behavior
  NORMAL = 2,   // Same as INFO
}

/**
 * Structured log entry format
 */
export interface LogEntry {
  /** ISO 8601 timestamp */
  timestamp: string
  /** Log level name */
  level: 'debug' | 'info' | 'warn' | 'error'
  /** Log message */
  message: string
  /** Optional correlation ID for request tracing */
  correlationId?: string
  /** Request duration in milliseconds (for request logs) */
  durationMs?: number
  /** Additional structured data */
  data?: Record<string, unknown>
}

/**
 * Configuration for the CLI logger
 */
export interface CLILoggerConfig {
  /** Minimum log level to output (default: INFO) */
  level: LogLevel
  /** Whether to output JSON format (default: false for human-readable) */
  json?: boolean
  /** Correlation ID to include in all log entries */
  correlationId?: string
  /** Custom output function (default: console methods) */
  output?: {
    debug?: (message: string) => void
    info?: (message: string) => void
    warn?: (message: string) => void
    error?: (message: string) => void
  }
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: CLILoggerConfig = {
  level: LogLevel.INFO,
  json: false,
}

/**
 * Parse log level from string (for CLI flags)
 */
export function parseLogLevel(level: string | undefined): LogLevel {
  if (!level) return LogLevel.INFO

  switch (level.toLowerCase()) {
    case 'debug':
      return LogLevel.DEBUG
    case 'verbose':
      return LogLevel.VERBOSE
    case 'info':
    case 'normal':
      return LogLevel.INFO
    case 'warn':
    case 'warning':
      return LogLevel.WARN
    case 'error':
      return LogLevel.ERROR
    case 'silent':
    case 'none':
    case 'quiet':
      return LogLevel.SILENT
    default:
      return LogLevel.INFO
  }
}

/**
 * Format a log entry for output
 */
function formatEntry(entry: LogEntry, json: boolean): string {
  if (json) {
    return JSON.stringify(entry)
  }

  // Human-readable format: [timestamp] [level] message (correlationId) duration
  const parts: string[] = []

  // Timestamp in short format for CLI
  const time = new Date(entry.timestamp).toLocaleTimeString('en-US', { hour12: false })
  parts.push(`[${time}]`)

  // Level with color hint (actual colors applied by consumer)
  parts.push(`[${entry.level.toUpperCase()}]`)

  // Message
  parts.push(entry.message)

  // Correlation ID
  if (entry.correlationId) {
    parts.push(`(${entry.correlationId.slice(0, 8)}...)`)
  }

  // Duration
  if (entry.durationMs !== undefined) {
    parts.push(`${entry.durationMs}ms`)
  }

  // Additional data
  if (entry.data && Object.keys(entry.data).length > 0) {
    parts.push(JSON.stringify(entry.data))
  }

  return parts.join(' ')
}

/**
 * CLI Logger - Structured logging for rpc.do CLI
 *
 * Provides:
 * - Log level filtering (debug, info, warn, error, silent)
 * - Structured JSON output for machine parsing
 * - Human-readable format for CLI usage
 * - Correlation ID propagation for request tracing
 * - Request timing support
 *
 * @example
 * ```typescript
 * const logger = new CLILogger({ level: LogLevel.DEBUG, json: false })
 *
 * // Basic logging
 * logger.info('Starting operation')
 * logger.debug('Debug details', { key: 'value' })
 *
 * // With correlation ID
 * logger.setCorrelationId('abc-123')
 * logger.info('Processing request')
 *
 * // Request timing
 * const timer = logger.startTimer()
 * await doWork()
 * logger.info('Request complete', undefined, timer())
 * ```
 */
export class CLILogger {
  private config: CLILoggerConfig
  private correlationId?: string

  constructor(config: Partial<CLILoggerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    if (config.correlationId !== undefined) {
      this.correlationId = config.correlationId
    }
  }

  /**
   * Set the correlation ID for subsequent log entries
   */
  setCorrelationId(correlationId: string): void {
    this.correlationId = correlationId
  }

  /**
   * Get the current correlation ID
   */
  getCorrelationId(): string | undefined {
    return this.correlationId
  }

  /**
   * Set the log level
   */
  setLevel(level: LogLevel): void {
    this.config.level = level
  }

  /**
   * Get the current log level
   */
  getLevel(): LogLevel {
    return this.config.level
  }

  /**
   * Set JSON output mode
   */
  setJsonOutput(json: boolean): void {
    this.config.json = json
  }

  /**
   * Start a timer for measuring request duration
   * Returns a function that returns the elapsed time in milliseconds
   */
  startTimer(): () => number {
    const start = performance.now()
    return () => Math.round(performance.now() - start)
  }

  /**
   * Create a child logger with inherited correlation ID
   */
  child(correlationId?: string): CLILogger {
    const childCorrelationId = correlationId ?? this.correlationId
    const config: Partial<CLILoggerConfig> = { ...this.config }
    if (childCorrelationId !== undefined) {
      config.correlationId = childCorrelationId
    }
    return new CLILogger(config)
  }

  /**
   * Log at DEBUG level
   */
  debug(message: string, data?: Record<string, unknown>, durationMs?: number): void {
    this.log(LogLevel.DEBUG, 'debug', message, data, durationMs)
  }

  /**
   * Log at INFO level
   */
  info(message: string, data?: Record<string, unknown>, durationMs?: number): void {
    this.log(LogLevel.INFO, 'info', message, data, durationMs)
  }

  /**
   * Log at WARN level
   */
  warn(message: string, data?: Record<string, unknown>, durationMs?: number): void {
    this.log(LogLevel.WARN, 'warn', message, data, durationMs)
  }

  /**
   * Log at ERROR level
   */
  error(message: string, data?: Record<string, unknown>, durationMs?: number): void {
    this.log(LogLevel.ERROR, 'error', message, data, durationMs)
  }

  /**
   * Internal log method
   */
  private log(
    levelNum: LogLevel,
    levelName: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>,
    durationMs?: number
  ): void {
    // Check if this level should be logged
    if (this.config.level > levelNum) {
      return
    }

    // Build log entry
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: levelName,
      message,
    }

    if (this.correlationId) {
      entry.correlationId = this.correlationId
    }

    if (durationMs !== undefined) {
      entry.durationMs = durationMs
    }

    if (data && Object.keys(data).length > 0) {
      entry.data = data
    }

    // Format and output
    const formatted = formatEntry(entry, this.config.json ?? false)
    const output = this.config.output ?? {}

    switch (levelName) {
      case 'debug':
        (output.debug ?? console.debug)(formatted)
        break
      case 'info':
        (output.info ?? console.info)(formatted)
        break
      case 'warn':
        (output.warn ?? console.warn)(formatted)
        break
      case 'error':
        (output.error ?? console.error)(formatted)
        break
    }
  }

  /**
   * Create a log entry object without outputting
   * Useful for testing or custom processing
   */
  createEntry(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: string,
    data?: Record<string, unknown>,
    durationMs?: number
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    }

    if (this.correlationId) {
      entry.correlationId = this.correlationId
    }

    if (durationMs !== undefined) {
      entry.durationMs = durationMs
    }

    if (data && Object.keys(data).length > 0) {
      entry.data = data
    }

    return entry
  }
}

/**
 * Create a logger from CLI options
 *
 * @example
 * ```typescript
 * // In CLI command handler
 * const logger = createLoggerFromOptions({
 *   verbose: options.verbose,
 *   quiet: options.quiet,
 *   json: options.json,
 * })
 * ```
 */
export function createLoggerFromOptions(options: {
  verbose?: boolean
  debug?: boolean
  quiet?: boolean
  json?: boolean
  correlationId?: string
}): CLILogger {
  let level = LogLevel.INFO

  if (options.debug) {
    level = LogLevel.DEBUG
  } else if (options.verbose) {
    level = LogLevel.VERBOSE
  } else if (options.quiet) {
    level = LogLevel.WARN
  }

  const config: Partial<CLILoggerConfig> = { level }
  if (options.json !== undefined) {
    config.json = options.json
  }
  if (options.correlationId !== undefined) {
    config.correlationId = options.correlationId
  }
  return new CLILogger(config)
}

/**
 * Global CLI logger instance (for simple use cases)
 * For request-scoped logging, create a new CLILogger instance
 */
export const cliLogger = new CLILogger()

// ============================================================================
// Simple verbose/debug API for CLI commands
// ============================================================================

/** Current global log level for simple API */
let simpleLogLevel: LogLevel = LogLevel.NORMAL

/**
 * Get the current log level (simple API)
 */
export function getLogLevel(): LogLevel {
  return simpleLogLevel
}

/**
 * Set the global log level (simple API)
 */
export function setLogLevel(level: LogLevel): void {
  simpleLogLevel = level
}

/**
 * Get log level from environment variables
 *
 * Checks for:
 * - RPC_DO_DEBUG=1 -> DEBUG
 * - RPC_DO_VERBOSE=1 -> VERBOSE
 * - DEBUG=rpc.do or DEBUG=rpc.do:* -> DEBUG
 */
export function getLogLevelFromEnv(): LogLevel {
  // Check RPC_DO_DEBUG first (highest priority env var)
  if (process.env['RPC_DO_DEBUG'] === '1' || process.env['RPC_DO_DEBUG'] === 'true') {
    return LogLevel.DEBUG
  }

  // Check DEBUG=rpc.do pattern
  const debugEnv = process.env['DEBUG'] ?? ''
  if (debugEnv === 'rpc.do' || debugEnv.startsWith('rpc.do:') || debugEnv === '*') {
    return LogLevel.DEBUG
  }

  // Check RPC_DO_VERBOSE
  if (process.env['RPC_DO_VERBOSE'] === '1' || process.env['RPC_DO_VERBOSE'] === 'true') {
    return LogLevel.VERBOSE
  }

  return LogLevel.NORMAL
}

/**
 * Initialize log level from environment variables
 * Call this at CLI startup to respect env vars
 */
export function initLogLevelFromEnv(): void {
  const envLevel = getLogLevelFromEnv()
  if (envLevel !== LogLevel.NORMAL) {
    setLogLevel(envLevel)
  }
}

/**
 * Simple logger options
 */
export interface SimpleLoggerOptions {
  /** Custom output function (default: console.log) */
  output?: ((message: string) => void) | undefined
  /** Custom error output function (default: console.error) */
  errorOutput?: ((message: string) => void) | undefined
  /** Prefix for log messages */
  prefix?: string | undefined
}

/**
 * Simple Logger interface for CLI commands
 */
export interface Logger {
  /** Log an info message (always shown) */
  info(message: string): void
  /** Log a verbose message (shown at VERBOSE or DEBUG level) */
  verbose(message: string): void
  /** Log a debug message (shown only at DEBUG level) */
  debug(message: string): void
  /** Log an error message (always shown) */
  error(message: string): void
  /** Log timing information (shown at VERBOSE or DEBUG level) */
  timing(label: string, durationMs: number): void
  /** Log a request (shown at VERBOSE or DEBUG level) */
  request(method: string, url: string, body?: unknown): void
  /** Log a response (shown at VERBOSE or DEBUG level) */
  response(status: number, body?: unknown): void
  /** Log auth status (shown only at DEBUG level) */
  auth(hasToken: boolean, tokenPreview?: string): void
}

/**
 * Create a simple logger instance for CLI commands
 *
 * @example
 * ```typescript
 * const logger = createLogger()
 * logger.info('Starting operation')
 * logger.verbose('Request sent to server')
 * logger.debug('Raw response: {...}')
 * ```
 */
export function createLogger(options: SimpleLoggerOptions = {}): Logger {
  const output = options.output ?? console.log
  const errorOutput = options.errorOutput ?? console.error
  const prefix = options.prefix ?? ''

  const formatPrefix = (level: string): string => {
    const p = prefix ? `${prefix} ` : ''
    return `${p}[${level}]`
  }

  return {
    info(message: string): void {
      output(message)
    },

    verbose(message: string): void {
      if (simpleLogLevel <= LogLevel.VERBOSE) {
        output(`${formatPrefix('VERBOSE')} ${message}`)
      }
    },

    debug(message: string): void {
      if (simpleLogLevel <= LogLevel.DEBUG) {
        output(`${formatPrefix('DEBUG')} ${message}`)
      }
    },

    error(message: string): void {
      errorOutput(`${formatPrefix('ERROR')} ${message}`)
    },

    timing(label: string, durationMs: number): void {
      if (simpleLogLevel <= LogLevel.VERBOSE) {
        output(`${formatPrefix('TIMING')} ${label}: ${durationMs.toFixed(2)}ms`)
      }
    },

    request(method: string, url: string, body?: unknown): void {
      if (simpleLogLevel <= LogLevel.VERBOSE) {
        output(`${formatPrefix('REQUEST')} ${method} ${url}`)
      }
      if (simpleLogLevel <= LogLevel.DEBUG && body !== undefined) {
        output(`${formatPrefix('DEBUG')} Request body: ${JSON.stringify(body, null, 2)}`)
      }
    },

    response(status: number, body?: unknown): void {
      if (simpleLogLevel <= LogLevel.VERBOSE) {
        output(`${formatPrefix('RESPONSE')} Status: ${status}`)
      }
      if (simpleLogLevel <= LogLevel.DEBUG && body !== undefined) {
        output(`${formatPrefix('DEBUG')} Response body: ${JSON.stringify(body, null, 2)}`)
      }
    },

    auth(hasToken: boolean, tokenPreview?: string): void {
      if (simpleLogLevel <= LogLevel.DEBUG) {
        if (hasToken) {
          const preview = tokenPreview ? ` (${tokenPreview}...)` : ''
          output(`${formatPrefix('DEBUG')} Auth: Bearer token present${preview}`)
        } else {
          output(`${formatPrefix('DEBUG')} Auth: No token (anonymous)`)
        }
      }
    },
  }
}

/**
 * Default simple logger instance
 */
export const defaultLogger = createLogger()
