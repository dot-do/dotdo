/**
 * Structured Logging for dotdo
 *
 * Provides structured JSON logging with:
 * - Multiple log levels (DEBUG, INFO, WARN, ERROR, FATAL, SILENT)
 * - Automatic sensitive data redaction (passwords, tokens, API keys)
 * - Child loggers with inherited context
 * - Correlation ID and trace context support
 * - JSON and pretty output formats
 *
 * @module observability/logger
 */

/**
 * Log levels in order of severity
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  FATAL = 4,
  SILENT = 5,
}

/**
 * Log output format
 */
export type LogFormat = 'json' | 'pretty'

/**
 * Logger configuration
 */
export interface LoggerConfig {
  level: LogLevel
  format: LogFormat
  service: string
  output?: (level: string, message: string) => void
}

/**
 * Context that can be attached to log entries
 */
export interface LogContext {
  correlationId?: string
  traceId?: string
  spanId?: string
  [key: string]: unknown
}

/**
 * A single log entry structure
 */
export interface LogEntry {
  timestamp: string
  level: string
  message: string
  service: string
  [key: string]: unknown
}

/**
 * Structured logger interface
 */
export interface StructuredLogger {
  debug(message: string, context?: Record<string, unknown>): void
  info(message: string, context?: Record<string, unknown>): void
  warn(message: string, context?: Record<string, unknown>): void
  error(message: string, errorOrContext?: Error | Record<string, unknown>): void
  fatal(message: string, context?: Record<string, unknown>): void
  child(context: LogContext): StructuredLogger
  withContext(context: LogContext): void
  setLevel(level: LogLevel): void
  getLevel(): LogLevel
}

/**
 * Global logger configuration
 */
let globalConfig: LoggerConfig = {
  level: LogLevel.INFO,
  format: 'json',
  service: 'dotdo',
}

/**
 * Parse log level from string
 */
export function parseLogLevel(level: string | undefined): LogLevel {
  if (!level) return LogLevel.INFO

  switch (level.toUpperCase()) {
    case 'DEBUG':
    case 'TRACE':
      return LogLevel.DEBUG
    case 'INFO':
      return LogLevel.INFO
    case 'WARN':
    case 'WARNING':
      return LogLevel.WARN
    case 'ERROR':
      return LogLevel.ERROR
    case 'FATAL':
    case 'CRITICAL':
      return LogLevel.FATAL
    case 'SILENT':
    case 'NONE':
    case 'OFF':
      return LogLevel.SILENT
    default:
      return LogLevel.INFO
  }
}

/**
 * Configure the global logger
 */
export function configureLogger(config: Partial<LoggerConfig>): void {
  globalConfig = { ...globalConfig, ...config }
}

/**
 * Get the current global logger config
 */
export function getLoggerConfig(): LoggerConfig {
  return { ...globalConfig }
}

/**
 * Keys that should have their values redacted
 */
const SENSITIVE_KEYS = [
  'password',
  'passwd',
  'secret',
  'apikey',
  'api_key',
  'apiKey',
  'token',
  'accesstoken',
  'access_token',
  'accessToken',
  'authorization',
  'auth',
  'credential',
  'credentials',
  'privatekey',
  'private_key',
  'privateKey',
]

/**
 * Patterns that indicate sensitive values
 */
const SENSITIVE_PATTERNS = [
  // JWT tokens
  /^eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/,
  // Bearer tokens
  /^Bearer\s+.+$/i,
  // API keys (common patterns)
  /^sk[-_][a-zA-Z0-9]+$/,
  /^pk[-_][a-zA-Z0-9]+$/,
]

/**
 * Check if a key indicates sensitive data
 */
function isSensitiveKey(key: string): boolean {
  const lowerKey = key.toLowerCase()
  return SENSITIVE_KEYS.some(sensitive => lowerKey.includes(sensitive))
}

/**
 * Check if a value matches sensitive patterns
 */
function isSensitiveValue(value: unknown): boolean {
  if (typeof value !== 'string') return false
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(value))
}

/**
 * Redact sensitive data from an object
 */
function redactSensitiveData(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key) || isSensitiveValue(value)) {
      result[key] = '[REDACTED]'
    } else if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Error)) {
      result[key] = redactSensitiveData(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }

  return result
}

/**
 * Format error for logging
 */
function formatError(error: Error): Record<string, unknown> {
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  }
}

/**
 * Level name mapping
 */
const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'debug',
  [LogLevel.INFO]: 'info',
  [LogLevel.WARN]: 'warn',
  [LogLevel.ERROR]: 'error',
  [LogLevel.FATAL]: 'fatal',
  [LogLevel.SILENT]: 'silent',
}

/**
 * Format log entry as JSON
 */
function formatJSON(entry: LogEntry): string {
  return JSON.stringify(entry)
}

/**
 * Format log entry for human reading
 */
function formatPretty(entry: LogEntry): string {
  const { timestamp, level, message, service, ...rest } = entry
  const time = timestamp.split('T')[1]?.split('.')[0] || timestamp
  const levelStr = `[${level.toUpperCase()}]`.padEnd(7)
  const serviceStr = `[${service}]`

  let output = `${time} ${levelStr} ${serviceStr} ${message}`

  if (Object.keys(rest).length > 0) {
    output += ` ${JSON.stringify(rest)}`
  }

  return output
}

/**
 * Create a structured logger instance
 */
export function createStructuredLogger(options: Partial<LoggerConfig> = {}): StructuredLogger {
  const config: LoggerConfig = {
    level: options.level ?? globalConfig.level,
    format: options.format ?? globalConfig.format,
    service: options.service ?? globalConfig.service,
  }
  // Only set output if explicitly provided (avoid undefined assignment with exactOptionalPropertyTypes)
  if ('output' in options && options.output !== undefined) {
    config.output = options.output
  }

  let boundContext: LogContext = {}

  function shouldLog(level: LogLevel): boolean {
    return level >= config.level
  }

  function log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!shouldLog(level)) return

    // Try to get correlation ID from observability context if not in boundContext
    let correlationId: string | undefined
    if (!boundContext.correlationId) {
      try {
        // Dynamic require avoids circular dependency between logger and context modules
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        const ctxModule = require('./context')
        correlationId = ctxModule.getCorrelationId?.() || undefined
      } catch {
        // Context module not available or getCorrelationId failed
      }
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: LEVEL_NAMES[level],
      message,
      service: config.service,
      // Include correlation ID from context if available and not already in boundContext
      ...(correlationId && { correlationId }),
      ...boundContext,
      ...redactSensitiveData(context || {}),
    }

    const formatted = config.format === 'pretty' ? formatPretty(entry) : formatJSON(entry)

    if (config.output) {
      config.output(LEVEL_NAMES[level], formatted)
    } else {
      // Use appropriate console method based on level
      switch (level) {
        case LogLevel.DEBUG:
          console.debug(formatted)
          break
        case LogLevel.INFO:
          console.info(formatted)
          break
        case LogLevel.WARN:
          console.warn(formatted)
          break
        case LogLevel.ERROR:
        case LogLevel.FATAL:
          console.error(formatted)
          break
      }
    }
  }

  const logger: StructuredLogger = {
    debug(message: string, context?: Record<string, unknown>): void {
      log(LogLevel.DEBUG, message, context)
    },

    info(message: string, context?: Record<string, unknown>): void {
      log(LogLevel.INFO, message, context)
    },

    warn(message: string, context?: Record<string, unknown>): void {
      log(LogLevel.WARN, message, context)
    },

    error(message: string, errorOrContext?: Error | Record<string, unknown>): void {
      if (errorOrContext instanceof Error) {
        log(LogLevel.ERROR, message, { error: formatError(errorOrContext) })
      } else {
        log(LogLevel.ERROR, message, errorOrContext)
      }
    },

    fatal(message: string, context?: Record<string, unknown>): void {
      log(LogLevel.FATAL, message, context)
    },

    child(context: LogContext): StructuredLogger {
      const childLogger = createStructuredLogger({
        ...config,
        ...(config.output !== undefined && { output: config.output }),
      })
      // Merge parent's bound context with child context
      childLogger.withContext({ ...boundContext, ...context })
      return childLogger
    },

    withContext(context: LogContext): void {
      boundContext = { ...boundContext, ...context }
    },

    setLevel(level: LogLevel): void {
      config.level = level
    },

    getLevel(): LogLevel {
      return config.level
    },
  }

  return logger
}

/**
 * Default global logger instance
 */
export const logger = createStructuredLogger()
